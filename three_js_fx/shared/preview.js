// Outside OBS, puts a mock desktop behind the overlay so the effects can be
// judged against both light and dark content, and hides the system cursor.
// Inside OBS (or with ?bg=0) the page stays fully transparent.
import { inOBS, params } from './cursor-feed.js';

const DESKTOP = `
<div class="pv-wallpaper"></div>
<section class="pv-window pv-light" style="left:7%;top:12%;width:44%;height:56%">
	<header><i></i><i></i><i></i><span>Quarterly notes.txt</span></header>
	<div class="pv-body">
		<h2 data-cursor="text">Release checklist</h2>
		<p data-cursor="text"><b style="width:92%"></b><b style="width:78%"></b><b style="width:85%"></b><b style="width:40%"></b></p>
		<p data-cursor="text"><b style="width:88%"></b><b style="width:66%"></b><b style="width:73%"></b></p>
		<nav><a data-cursor="pointer">Open report</a><a data-cursor="pointer">Share</a></nav>
	</div>
</section>
<section class="pv-window pv-dark" style="left:46%;top:30%;width:46%;height:58%">
	<header><i></i><i></i><i></i><span>main.js — editor</span></header>
	<div class="pv-body pv-code" data-cursor="text">
		<p><b class="k" style="width:14%"></b><b style="width:30%"></b><b class="s" style="width:22%"></b></p>
		<p><b style="width:8%;margin-left:6%"></b><b class="f" style="width:26%"></b><b style="width:12%"></b></p>
		<p><b class="k" style="width:10%;margin-left:6%"></b><b class="s" style="width:40%"></b></p>
		<p><b class="c" style="width:52%;margin-left:12%"></b></p>
		<p><b style="width:18%;margin-left:12%"></b><b class="f" style="width:20%"></b><b class="s" style="width:16%"></b></p>
		<p><b class="k" style="width:9%"></b></p>
		<p><b class="c" style="width:34%"></b></p>
	</div>
	<div class="pv-busy" data-cursor="wait">Building…</div>
</section>
<footer class="pv-taskbar"><i></i><i></i><i></i><i></i><span>12:40</span></footer>`;

if (!inOBS && params.get('bg') !== '0') {
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = new URL('./preview.css', import.meta.url).href;
	document.head.appendChild(link);
	const desktop = document.createElement('div');
	desktop.className = 'pv-desktop';
	desktop.innerHTML = DESKTOP;
	document.body.prepend(desktop);
	document.documentElement.classList.add('preview');
}

if (!inOBS) document.documentElement.classList.add('no-system-cursor');
