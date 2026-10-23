// Mouse state for the overlay pages.
//
// Inside OBS, browser_cursor.lua dispatches an "obs-cursor" CustomEvent on
// window whenever the mouse changes, plus a keepalive. Its detail:
//
//   x, y      position in source pixels
//   nx, ny    position normalised to the captured monitor, 0..1
//   buttons   bitmask as in MouseEvent.buttons: 1 left, 2 right, 4 middle, 8 back, 16 forward
//   cursor    CSS keyword of the system cursor shape (see SHAPES)
//   visible   false while the cursor is hidden or off the captured monitor
//   t         OBS clock in milliseconds
//
// Outside OBS the same state comes from pointer events, or from a scripted
// autopilot when the page is opened with ?demo.

export const inOBS = typeof window.obsstudio === 'object';
export const params = new URLSearchParams(location.search);

export const SHAPES = [
	'default', 'pointer', 'text', 'wait', 'progress', 'crosshair', 'move', 'help', 'not-allowed',
	'ew-resize', 'ns-resize', 'nwse-resize', 'nesw-resize',
];

const HISTORY = 128;           // samples kept for trails
const OBS_PRIORITY_MS = 1000;  // pointer events are ignored this long after an OBS event
const VELOCITY_WINDOW_MS = 60;
const STOPPED_MS = 90;         // no sample for this long means the cursor stopped
const SMOOTH_MIN_MS = 4;       // bounds of the delay sx/sy run behind the newest sample
const SMOOTH_MAX_MS = 34;
const HIDE_GRACE_MS = 120;     // an OBS hide only counts once it lasts this long

// MouseEvent.buttons bit -> MouseEvent.button index
const BUTTON_BITS = [[1, 0], [2, 2], [4, 1], [8, 3], [16, 4]];

export class CursorFeed {
	constructor({ demo = params.has('demo') } = {}) {
		this.x = innerWidth / 2;
		this.y = innerHeight / 2;
		this.prevX = this.x;     // position at the previous update(): this frame moved prev -> x
		this.prevY = this.y;
		// x/y interpolated between samples at render time: steady motion even when
		// samples arrive slower than frames or out of step with them. They trail
		// the newest sample by about one sample interval.
		this.sx = this.x;
		this.sy = this.y;
		this.prevSX = this.sx;     // sx/sy at the previous update()
		this.prevSY = this.sy;
		this.vx = 0;             // px/s
		this.vy = 0;
		this.speed = 0;
		this.buttons = 0;
		this.shape = 'default';
		this.visible = false;
		this.idle = 0;           // seconds since the cursor last moved
		this.held = 0;           // seconds the primary button has been held, 0 when up
		this.source = 'none';    // 'obs' | 'pointer' | 'demo'
		this.history = [];       // recent samples {x, y, t}, oldest first, t on the performance.now() clock

		this._listeners = new Map();
		this._lastUpdate = 0;
		this._lastMove = performance.now();
		this._downAt = 0;
		this._obsSeen = -Infinity;
		this._obsHiddenAt = null; // when OBS first reported the cursor hidden, while still shown here
		this._offset = null;     // performance.now() - OBS clock, estimated from the fastest delivery
		this._lastArrival = 0;
		this._interval = 16;     // ms between samples, smoothed
		this._jitter = 2;        // ms, smoothed deviation of that interval
		this._demoStart = demo ? performance.now() : null;

		addEventListener('obs-cursor', (e) => this._onObs(e.detail));
		if (!inOBS && !demo) this._listenPointer();
	}

	get down() {
		return (this.buttons & 1) !== 0;
	}

	// type: 'down' | 'up' (detail {button, x, y}), 'move' ({x, y, t}),
	// 'shape' ({shape, previous}), 'show', 'hide'. Returns an unsubscribe function.
	on(type, fn) {
		let set = this._listeners.get(type);
		if (!set) this._listeners.set(type, (set = new Set()));
		set.add(fn);
		return () => set.delete(fn);
	}

	// Call once per animation frame before reading the derived values.
	update(now = performance.now()) {
		const dt = this._lastUpdate ? Math.min((now - this._lastUpdate) / 1000, 0.1) : 0;
		this._lastUpdate = now;

		if (this._demoStart !== null) {
			const s = demoState((now - this._demoStart) / 1000, innerWidth, innerHeight);
			this._apply(s.x, s.y, s.buttons, s.shape, s.visible, now, 'demo');
		}
		// OBS resends an unchanged state only every 0.5 s, so a hide still in its
		// grace period is settled here rather than by the next event.
		if (this._obsHiddenAt !== null && now - this._obsHiddenAt >= HIDE_GRACE_MS) {
			this._obsHiddenAt = null;
			this._apply(this.x, this.y, this.buttons, this.shape, false, now, 'obs');
		}

		this.prevX = this._frameX ?? this.x;
		this.prevY = this._frameY ?? this.y;
		this._frameX = this.x;
		this._frameY = this.y;
		this.prevSX = this.sx;
		this.prevSY = this.sy;
		this._interpolate(now);

		let tvx = 0;
		let tvy = 0;
		const h = this.history;
		const newest = h[h.length - 1];
		if (newest && now - newest.t < STOPPED_MS) {
			let i = h.length - 1;
			while (i > 0 && newest.t - h[i - 1].t <= VELOCITY_WINDOW_MS) i--;
			const span = (newest.t - h[i].t) / 1000;
			if (span > 0.004) {
				tvx = (newest.x - h[i].x) / span;
				tvy = (newest.y - h[i].y) / span;
			} else {
				tvx = this.vx;
				tvy = this.vy;
			}
		}
		const k = 1 - Math.exp(-dt * 25);
		this.vx += (tvx - this.vx) * k;
		this.vy += (tvy - this.vy) * k;
		this.speed = Math.hypot(this.vx, this.vy);

		this.idle = (now - this._lastMove) / 1000;
		this.held = this.down ? (now - this._downAt) / 1000 : 0;
	}

	_interpolate(now) {
		const h = this.history;
		const n = h.length;
		if (n === 0) return;
		// Late enough that the next sample has nearly always arrived.
		const delay = Math.min(SMOOTH_MAX_MS, Math.max(SMOOTH_MIN_MS, this._interval + 2.5 * this._jitter));
		const at = Math.min(now - delay, h[n - 1].t);
		let i = n - 1;
		while (i > 0 && h[i - 1].t > at) i--;
		const b = h[i];
		const a = i > 0 ? h[i - 1] : b;
		const f = b.t > a.t ? Math.min(1, Math.max(0, (at - a.t) / (b.t - a.t))) : 1;
		this.sx = a.x + (b.x - a.x) * f;
		this.sy = a.y + (b.y - a.y) * f;
	}

	_emit(type, detail) {
		const set = this._listeners.get(type);
		if (set) for (const fn of set) fn(detail);
	}

	_onObs(d) {
		if (!d) return;
		const arrival = performance.now();
		const lag = arrival - d.t;
		this._offset = this._offset === null
			? lag
			: Math.min(this._offset + (arrival - this._lastArrival) * 0.001, lag);
		this._lastArrival = arrival;
		this._obsSeen = arrival;
		const x = Number.isFinite(d.nx) ? d.nx * innerWidth : d.x;
		const y = Number.isFinite(d.ny) ? d.ny * innerHeight : d.y;
		// One-frame hides from the browser source never reach the effects.
		let visible = d.visible !== false;
		if (visible || !this.visible) this._obsHiddenAt = null;
		else if ((this._obsHiddenAt ??= arrival) && arrival - this._obsHiddenAt < HIDE_GRACE_MS) visible = true;
		this._apply(x, y, d.buttons | 0, d.cursor || 'default', visible, d.t + this._offset, 'obs');
	}

	_listenPointer() {
		const fromPointer = () => performance.now() - this._obsSeen > OBS_PRIORITY_MS;
		const shapeOf = (e) => e.target?.closest?.('[data-cursor]')?.dataset.cursor ?? 'default';
		const onPointer = (e) => {
			if (!fromPointer()) return;
			const shape = shapeOf(e);
			const list = e.type === 'pointermove' && e.getCoalescedEvents ? e.getCoalescedEvents() : [];
			if (list.length === 0) list.push(e);
			for (const c of list) this._apply(c.clientX, c.clientY, e.buttons, shape, true, c.timeStamp, 'pointer');
		};
		addEventListener('pointermove', onPointer, { passive: true });
		addEventListener('pointerdown', onPointer, { passive: true });
		addEventListener('pointerup', onPointer, { passive: true });
		document.documentElement.addEventListener('pointerleave', (e) => {
			if (fromPointer()) this._apply(e.clientX, e.clientY, 0, this.shape, false, e.timeStamp, 'pointer');
		});
		addEventListener('blur', () => {
			if (fromPointer()) this._apply(this.x, this.y, 0, this.shape, this.visible, performance.now(), 'pointer');
		});
		addEventListener('contextmenu', (e) => e.preventDefault());
	}

	_apply(x, y, buttons, shape, visible, t, source) {
		this.source = source;

		if (visible !== this.visible) {
			this.visible = visible;
			if (visible) {
				this.history.length = 0;
				this.x = this._frameX = this.sx = this.prevSX = x;
				this.y = this._frameY = this.sy = this.prevSY = y;
				this.vx = this.vy = this.speed = 0;
			}
			this._emit(visible ? 'show' : 'hide', { x, y });
		}

		if (x !== this.x || y !== this.y || this.history.length === 0) {
			this.x = x;
			this.y = y;
			this._lastMove = performance.now();
			const h = this.history;
			const last = h[h.length - 1];
			if (last && t > last.t && t - last.t < 60) {
				const gap = t - last.t;
				this._jitter += (Math.abs(gap - this._interval) - this._jitter) * 0.1;
				this._interval += (gap - this._interval) * 0.1;
			}
			const s = h.length >= HISTORY ? h.shift() : {};
			s.x = x;
			s.y = y;
			s.t = t;
			h.push(s);
			this._emit('move', s);
		}

		if (shape !== this.shape) {
			const previous = this.shape;
			this.shape = shape;
			this._emit('shape', { shape, previous });
		}

		const changed = buttons ^ this.buttons;
		if (changed) {
			const wasDown = this.down;
			this.buttons = buttons;
			if (!wasDown && this.down) this._downAt = performance.now();
			for (const [bit, button] of BUTTON_BITS) {
				if (changed & bit) this._emit(buttons & bit ? 'down' : 'up', { button, x, y });
			}
		}
	}
}

// Scripted 14 s choreography used by ?demo and by automated checks: glide,
// fast flicks, clicks, a drag, hovering links and text, busy cursors, a fast
// right-button swirl, then a short hide. Deterministic in time.
export const DEMO_PERIOD = 14;

const FLICKS = [[0.22, 0.30], [0.78, 0.62], [0.30, 0.75], [0.70, 0.25], [0.18, 0.55], [0.62, 0.45]];
const CLICKS = [[0.35, 0.40], [0.55, 0.58], [0.68, 0.36]];

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const mix = (a, b, t) => a + (b - a) * t;

export function demoState(seconds, width, height) {
	const tau = ((seconds % DEMO_PERIOD) + DEMO_PERIOD) % DEMO_PERIOD;
	let nx;
	let ny;
	let buttons = 0;
	let shape = 'default';
	let visible = true;

	const glide = (t) => [0.5 + 0.28 * Math.sin(1.1 * t), 0.5 + 0.2 * Math.sin(1.7 * t + 0.6)];

	if (tau < 3.5) {
		[nx, ny] = glide(tau);
	} else if (tau < 5.5) {
		// Fast flicks between waypoints, starting where the glide ended.
		const f = (tau - 3.5) / (2 / FLICKS.length);
		const i = Math.floor(f);
		const from = i === 0 ? glide(3.5) : FLICKS[i - 1];
		const to = FLICKS[Math.min(i, FLICKS.length - 1)];
		const e = ease(Math.min(1, (f - i) * 1.6));
		nx = mix(from[0], to[0], e);
		ny = mix(from[1], to[1], e);
	} else if (tau < 8.5) {
		// Three clicks, then a press-and-drag along an arc.
		const t = tau - 5.5;
		const last = FLICKS[FLICKS.length - 1];
		if (t < 1.8) {
			const i = Math.floor(t / 0.6);
			const local = t - i * 0.6;
			const from = i === 0 ? last : CLICKS[i - 1];
			const e = ease(Math.min(1, local / 0.3));
			nx = mix(from[0], CLICKS[i][0], e);
			ny = mix(from[1], CLICKS[i][1], e);
			if (local > 0.36 && local < 0.48) buttons = 1;
		} else {
			const a = (t - 1.8) / 1.2;
			const angle = mix(-0.4, 2.2, ease(Math.min(1, a)));
			const c = CLICKS[2];
			nx = c[0] - 0.16 + 0.16 * Math.cos(angle);
			ny = c[1] + 0.2 * Math.sin(angle);
			if (a > 0.08 && a < 0.92) buttons = 1;
		}
	} else if (tau < 11) {
		// Hover a link, then sweep across a line of text with a click.
		const t = tau - 8.5;
		if (t < 1.2) {
			shape = 'pointer';
			nx = 0.42 + 0.012 * Math.sin(t * 9);
			ny = 0.33 + 0.008 * Math.cos(t * 7);
			if (t > 0.7 && t < 0.82) buttons = 1;
		} else {
			shape = 'text';
			nx = mix(0.3, 0.62, ease((t - 1.2) / 1.3));
			ny = 0.52;
			if (t > 2.2 && t < 2.3) buttons = 1;
		}
	} else if (tau < 12.5) {
		const t = tau - 11;
		shape = t < 0.75 ? 'wait' : 'progress';
		nx = 0.5 + 0.01 * Math.sin(t * 3);
		ny = 0.5;
	} else {
		// Fast right-button swirl, then the cursor disappears briefly.
		const t = tau - 12.5;
		const angle = t * 11;
		const r = 0.12 * Math.min(1, t * 4);
		nx = 0.5 + r * Math.cos(angle);
		ny = 0.5 + r * 1.4 * Math.sin(angle);
		if (t < 1.0) buttons = 2;
		if (t > 1.2) visible = false;
	}

	return { x: nx * width, y: ny * height, buttons, shape, visible };
}
