-- Direct3D 11 compute bindings for LuaJIT FFI.
--
-- OBS's graphics API (gs_*) has no compute stage, so the cursor VFX sources
-- drive the ID3D11Device that OBS already renders with. Only the compute
-- stage, UpdateSubresource, ClearUnorderedAccessView* and CopyResource are
-- used on OBS's immediate context. OBS never binds anything to the compute
-- stage, so its cached pipeline state stays valid.

local ffi = require("ffi")
local bit = require("bit")

ffi.cdef[[
typedef int32_t HRESULT;
typedef uint32_t UINT;

typedef struct VfxUnknownVtbl {
	HRESULT (__stdcall *QueryInterface)(void *self, const void *iid, void **out);
	uint32_t (__stdcall *AddRef)(void *self);
	uint32_t (__stdcall *Release)(void *self);
} VfxUnknownVtbl;
typedef struct VfxUnknown { const VfxUnknownVtbl *vt; } VfxUnknown;

typedef struct VfxGuid { uint32_t a; uint16_t b, c; uint8_t d[8]; } VfxGuid;

typedef struct VfxBufferDesc {
	UINT ByteWidth, Usage, BindFlags, CPUAccessFlags, MiscFlags, StructureByteStride;
} VfxBufferDesc;

typedef struct VfxTexture2DDesc {
	UINT Width, Height, MipLevels, ArraySize, Format;
	UINT SampleCount, SampleQuality;
	UINT Usage, BindFlags, CPUAccessFlags, MiscFlags;
} VfxTexture2DDesc;

typedef struct VfxUavDesc { UINT Format, ViewDimension, a, b, c; } VfxUavDesc;
typedef struct VfxMapped { void *pData; UINT RowPitch, DepthPitch; } VfxMapped;
typedef struct VfxQueryDesc { UINT Query, MiscFlags; } VfxQueryDesc;
typedef struct VfxDisjoint { uint64_t Frequency; int32_t Disjoint; } VfxDisjoint;
typedef struct VfxMessage { int Category, Severity, ID; const char *pDescription; size_t DescriptionByteLength; } VfxMessage;

/* ID3D11Device, up to GetImmediateContext (slot 40). */
typedef struct VfxDeviceVtbl {
	void *QueryInterface;
	void *AddRef;
	uint32_t (__stdcall *Release)(void *self);
	HRESULT (__stdcall *CreateBuffer)(void *self, const VfxBufferDesc *desc, const void *init, void **out);
	void *CreateTexture1D;
	HRESULT (__stdcall *CreateTexture2D)(void *self, const VfxTexture2DDesc *desc, const void *init, void **out);
	void *CreateTexture3D;
	void *CreateShaderResourceView;
	HRESULT (__stdcall *CreateUnorderedAccessView)(void *self, void *res, const VfxUavDesc *desc, void **out);
	void *CreateRenderTargetView;
	void *CreateDepthStencilView;
	void *CreateInputLayout;
	void *CreateVertexShader;
	void *CreateGeometryShader;
	void *CreateGeometryShaderWithStreamOutput;
	void *CreatePixelShader;
	void *CreateHullShader;
	void *CreateDomainShader;
	HRESULT (__stdcall *CreateComputeShader)(void *self, const char *code, size_t len, void *linkage, void **out);
	void *CreateClassLinkage;
	void *CreateBlendState;
	void *CreateDepthStencilState;
	void *CreateRasterizerState;
	void *CreateSamplerState;
	HRESULT (__stdcall *CreateQuery)(void *self, const VfxQueryDesc *desc, void **out);
	void *CreatePredicate;
	void *CreateCounter;
	void *CreateDeferredContext;
	void *OpenSharedResource;
	void *CheckFormatSupport;
	void *CheckMultisampleQualityLevels;
	void *CheckCounterInfo;
	void *CheckCounter;
	void *CheckFeatureSupport;
	void *GetPrivateData;
	void *SetPrivateData;
	void *SetPrivateDataInterface;
	UINT (__stdcall *GetFeatureLevel)(void *self);
	UINT (__stdcall *GetCreationFlags)(void *self);
	HRESULT (__stdcall *GetDeviceRemovedReason)(void *self);
	void (__stdcall *GetImmediateContext)(void *self, void **out);
} VfxDeviceVtbl;
typedef struct VfxDevice { const VfxDeviceVtbl *vt; } VfxDevice;

/* ID3D11DeviceContext, up to CSSetConstantBuffers (slot 71). */
typedef struct VfxContextVtbl {
	void *QueryInterface;
	void *AddRef;
	uint32_t (__stdcall *Release)(void *self);
	void *GetDevice;
	void *GetPrivateData;
	void *SetPrivateData;
	void *SetPrivateDataInterface;
	void *VSSetConstantBuffers;
	void *PSSetShaderResources;
	void *PSSetShader;
	void *PSSetSamplers;
	void *VSSetShader;
	void *DrawIndexed;
	void *Draw;
	HRESULT (__stdcall *Map)(void *self, void *res, UINT sub, UINT type, UINT flags, VfxMapped *out);
	void (__stdcall *Unmap)(void *self, void *res, UINT sub);
	void *PSSetConstantBuffers;
	void *IASetInputLayout;
	void *IASetVertexBuffers;
	void *IASetIndexBuffer;
	void *DrawIndexedInstanced;
	void *DrawInstanced;
	void *GSSetConstantBuffers;
	void *GSSetShader;
	void *IASetPrimitiveTopology;
	void *VSSetShaderResources;
	void *VSSetSamplers;
	void (__stdcall *Begin)(void *self, void *query);
	void (__stdcall *End)(void *self, void *query);
	HRESULT (__stdcall *GetData)(void *self, void *query, void *data, UINT size, UINT flags);
	void *SetPredication;
	void *GSSetShaderResources;
	void *GSSetSamplers;
	void *OMSetRenderTargets;
	void *OMSetRenderTargetsAndUnorderedAccessViews;
	void *OMSetBlendState;
	void *OMSetDepthStencilState;
	void *SOSetTargets;
	void *DrawAuto;
	void *DrawIndexedInstancedIndirect;
	void *DrawInstancedIndirect;
	void (__stdcall *Dispatch)(void *self, UINT x, UINT y, UINT z);
	void *DispatchIndirect;
	void *RSSetState;
	void *RSSetViewports;
	void *RSSetScissorRects;
	void *CopySubresourceRegion;
	void (__stdcall *CopyResource)(void *self, void *dst, void *src);
	void (__stdcall *UpdateSubresource)(void *self, void *dst, UINT sub, const void *box, const void *data, UINT row, UINT depth);
	void *CopyStructureCount;
	void *ClearRenderTargetView;
	void (__stdcall *ClearUnorderedAccessViewUint)(void *self, void *uav, const UINT *values);
	void *ClearUnorderedAccessViewFloat;
	void *ClearDepthStencilView;
	void *GenerateMips;
	void *SetResourceMinLOD;
	void *GetResourceMinLOD;
	void *ResolveSubresource;
	void *ExecuteCommandList;
	void *HSSetShaderResources;
	void *HSSetShader;
	void *HSSetSamplers;
	void *HSSetConstantBuffers;
	void *DSSetShaderResources;
	void *DSSetShader;
	void *DSSetSamplers;
	void *DSSetConstantBuffers;
	void *CSSetShaderResources;
	void (__stdcall *CSSetUnorderedAccessViews)(void *self, UINT start, UINT count, void *const *uavs, const UINT *counts);
	void (__stdcall *CSSetShader)(void *self, void *shader, void *const *instances, UINT count);
	void *CSSetSamplers;
	void (__stdcall *CSSetConstantBuffers)(void *self, UINT start, UINT count, void *const *buffers);
} VfxContextVtbl;
typedef struct VfxContext { const VfxContextVtbl *vt; } VfxContext;

/* ID3DBlob */
typedef struct VfxBlobVtbl {
	void *QueryInterface;
	void *AddRef;
	uint32_t (__stdcall *Release)(void *self);
	void *(__stdcall *GetBufferPointer)(void *self);
	size_t (__stdcall *GetBufferSize)(void *self);
} VfxBlobVtbl;
typedef struct VfxBlob { const VfxBlobVtbl *vt; } VfxBlob;

/* ID3D11InfoQueue (debug layer, offline tools only), up to slot 9. */
typedef struct VfxInfoQueueVtbl {
	void *QueryInterface;
	void *AddRef;
	uint32_t (__stdcall *Release)(void *self);
	HRESULT (__stdcall *SetMessageCountLimit)(void *self, uint64_t limit);
	void (__stdcall *ClearStoredMessages)(void *self);
	HRESULT (__stdcall *GetMessage)(void *self, uint64_t index, void *msg, size_t *len);
	void *GetNumMessagesAllowedByStorageFilter;
	void *GetNumMessagesDeniedByStorageFilter;
	uint64_t (__stdcall *GetNumStoredMessages)(void *self);
	uint64_t (__stdcall *GetNumStoredMessagesAllowedByRetrievalFilter)(void *self);
} VfxInfoQueueVtbl;
typedef struct VfxInfoQueue { const VfxInfoQueueVtbl *vt; } VfxInfoQueue;

HRESULT D3DCompile(const char *src, size_t len, const char *name, const void *defines, void *include,
                   const char *entry, const char *target, UINT flags1, UINT flags2, void **code, void **errors);
HRESULT D3D11CreateDevice(void *adapter, int driver, void *software, UINT flags, const int *levels,
                          UINT nlevels, UINT sdk, void **device, int *level, void **context);
]]

-- A wrong slot here would call the wrong COM method, so pin the layout.
local PTR = ffi.sizeof("void*")
assert(ffi.offsetof("VfxDeviceVtbl", "CreateComputeShader") == 18 * PTR)
assert(ffi.offsetof("VfxDeviceVtbl", "GetImmediateContext") == 40 * PTR)
assert(ffi.offsetof("VfxContextVtbl", "Dispatch") == 41 * PTR)
assert(ffi.offsetof("VfxContextVtbl", "CopyResource") == 47 * PTR)
assert(ffi.offsetof("VfxContextVtbl", "CSSetConstantBuffers") == 71 * PTR)

local M = {}

M.FORMAT_RGBA32F = 2
M.FORMAT_RGBA16F = 10
M.FORMAT_RGBA8 = 28

local USAGE_DEFAULT, USAGE_STAGING = 0, 3
local BIND_CONSTANT, BIND_SRV, BIND_UAV = 0x4, 0x8, 0x80
local MISC_STRUCTURED = 0x40
local CPU_READ = 0x20000
local UAV_BUFFER, UAV_TEXTURE2D = 1, 4
local MAP_READ = 1
local QUERY_TIMESTAMP, QUERY_DISJOINT = 2, 3

local COMPILE_FLAGS = bit.bor(0x8000, 0x800) -- OPTIMIZATION_LEVEL3 | ENABLE_STRICTNESS

local function hex(hr)
	return "0x" .. bit.tohex(hr)
end

function M.release(obj)
	if obj ~= nil then
		local u = ffi.cast("VfxUnknown*", obj)
		u.vt.Release(u)
	end
end

local compiler

-- Compile one cs_5_0 entry point. Returns bytecode (Lua string) and the
-- compiler log, or nil and the error text.
function M.compile(source, entry, name)
	compiler = compiler or ffi.load("d3dcompiler_47")
	local code, errors = ffi.new("void*[1]"), ffi.new("void*[1]")
	local hr = compiler.D3DCompile(source, #source, name, nil, nil, entry, "cs_5_0", COMPILE_FLAGS, 0, code, errors)
	local log
	if errors[0] ~= nil then
		local blob = ffi.cast("VfxBlob*", errors[0])
		log = ffi.string(blob.vt.GetBufferPointer(blob), blob.vt.GetBufferSize(blob))
		blob.vt.Release(blob)
	end
	if hr < 0 or code[0] == nil then
		M.release(code[0])
		return nil, log or ("D3DCompile failed " .. hex(hr))
	end
	local blob = ffi.cast("VfxBlob*", code[0])
	local bytes = ffi.string(blob.vt.GetBufferPointer(blob), blob.vt.GetBufferSize(blob))
	blob.vt.Release(blob)
	return bytes, log
end

local Gpu = {}
Gpu.__index = Gpu

local function new_gpu(device, context, owns_device)
	local self = setmetatable({}, Gpu)
	self.dev = ffi.cast("VfxDevice*", device)
	self.ctx = ffi.cast("VfxContext*", context)
	self.id = tonumber(ffi.cast("uintptr_t", device))
	self.owns_device = owns_device
	self.out = ffi.new("void*[1]")
	self.nulls = ffi.new("void*[8]")
	self.cbs = ffi.new("void*[2]")
	self.values = ffi.new("UINT[4]")
	return self
end

-- Wrap a device owned by someone else (OBS). Holds a reference to its
-- immediate context until destroy().
function M.wrap(device)
	local dev = ffi.cast("VfxDevice*", device)
	local out = ffi.new("void*[1]")
	dev.vt.GetImmediateContext(dev, out)
	if out[0] == nil then
		return nil, "the device has no immediate context"
	end
	return new_gpu(device, out[0], false)
end

-- Library handles live as long as the module: a collected ffi.load handle
-- calls FreeLibrary, which would unload code that live COM objects run.
local d3d11_lib

-- Create a standalone hardware device (offline preview tool).
function M.create_device(debug_layer)
	d3d11_lib = d3d11_lib or ffi.load("d3d11")
	local d3d11 = d3d11_lib
	local levels = ffi.new("int[1]", 0xb000) -- D3D_FEATURE_LEVEL_11_0
	local dev, ctx = ffi.new("void*[1]"), ffi.new("void*[1]")
	local flags = debug_layer and 0x2 or 0 -- D3D11_CREATE_DEVICE_DEBUG
	local hr = d3d11.D3D11CreateDevice(nil, 1, nil, flags, levels, 1, 7, dev, nil, ctx)
	if hr < 0 and flags ~= 0 then
		flags = 0
		hr = d3d11.D3D11CreateDevice(nil, 1, nil, 0, levels, 1, 7, dev, nil, ctx)
	end
	if hr < 0 then
		return nil, "D3D11CreateDevice failed " .. hex(hr)
	end
	local gpu = new_gpu(dev[0], ctx[0], true)
	gpu.debug = flags ~= 0
	return gpu
end

function Gpu:check(hr, what)
	if hr < 0 then
		error(what .. " failed (" .. hex(hr) .. ")", 3)
	end
end

-- RWStructuredBuffer with a UAV. Returns { res, uav, count, stride }.
function Gpu:structured(count, stride)
	local desc = ffi.new("VfxBufferDesc", count * stride, USAGE_DEFAULT, BIND_UAV, 0, MISC_STRUCTURED, stride)
	self:check(self.dev.vt.CreateBuffer(self.dev, desc, nil, self.out), "CreateBuffer")
	local res = self.out[0]
	local view = ffi.new("VfxUavDesc", 0, UAV_BUFFER, 0, count, 0)
	local hr = self.dev.vt.CreateUnorderedAccessView(self.dev, res, view, self.out)
	if hr < 0 then
		M.release(res)
		self:check(hr, "CreateUnorderedAccessView")
	end
	return { res = res, uav = self.out[0], count = count, stride = stride }
end

-- 2D texture with a UAV (compute writes, CopyResource reads).
function Gpu:texture(w, h, format)
	local desc = ffi.new("VfxTexture2DDesc", w, h, 1, 1, format, 1, 0, USAGE_DEFAULT, bit.bor(BIND_UAV, BIND_SRV), 0, 0)
	self:check(self.dev.vt.CreateTexture2D(self.dev, desc, nil, self.out), "CreateTexture2D")
	local res = self.out[0]
	local view = ffi.new("VfxUavDesc", format, UAV_TEXTURE2D, 0, 0, 0)
	local hr = self.dev.vt.CreateUnorderedAccessView(self.dev, res, view, self.out)
	if hr < 0 then
		M.release(res)
		self:check(hr, "CreateUnorderedAccessView")
	end
	return { res = res, uav = self.out[0], w = w, h = h, format = format }
end

function Gpu:constants(bytes)
	bytes = math.ceil(bytes / 16) * 16
	local desc = ffi.new("VfxBufferDesc", bytes, USAGE_DEFAULT, BIND_CONSTANT, 0, 0, 0)
	self:check(self.dev.vt.CreateBuffer(self.dev, desc, nil, self.out), "CreateBuffer")
	return { res = self.out[0], bytes = bytes }
end

function Gpu:shader(bytecode)
	self:check(self.dev.vt.CreateComputeShader(self.dev, bytecode, #bytecode, nil, self.out), "CreateComputeShader")
	return self.out[0]
end

-- Release a resource table created above.
function Gpu:free(t)
	if t then
		M.release(t.uav)
		M.release(t.res)
		t.uav, t.res = nil, nil
	end
end

function Gpu:update(res, data)
	self.ctx.vt.UpdateSubresource(self.ctx, res, 0, nil, data, 0, 0)
end

function Gpu:clear(uav, value)
	local v = self.values
	v[0], v[1], v[2], v[3] = value or 0, value or 0, value or 0, value or 0
	self.ctx.vt.ClearUnorderedAccessViewUint(self.ctx, uav, v)
end

function Gpu:copy(dst, src)
	self.ctx.vt.CopyResource(self.ctx, dst, src)
end

-- Bind `count` UAVs (a void*[] array) at u0.. and up to two constant buffers.
function Gpu:bind(uavs, count, cb0, cb1)
	local ctx = self.ctx
	ctx.vt.CSSetUnorderedAccessViews(ctx, 0, count, uavs, nil)
	self.cbs[0], self.cbs[1] = cb0, cb1
	ctx.vt.CSSetConstantBuffers(ctx, 0, 2, self.cbs)
end

function Gpu:dispatch(shader, x, y, z)
	if x <= 0 then
		return
	end
	local ctx = self.ctx
	ctx.vt.CSSetShader(ctx, shader, nil, 0)
	ctx.vt.Dispatch(ctx, x, y or 1, z or 1)
end

-- Leave the compute stage empty so no UAV stays bound while OBS draws.
function Gpu:unbind()
	local ctx = self.ctx
	ctx.vt.CSSetShader(ctx, nil, nil, 0)
	ctx.vt.CSSetUnorderedAccessViews(ctx, 0, 8, self.nulls, nil)
	ctx.vt.CSSetConstantBuffers(ctx, 0, 2, self.nulls)
end

function Gpu:destroy()
	if self.iq then
		M.release(self.iq)
		self.iq = nil
	end
	if self.ctx ~= nil then
		self:unbind()
		M.release(self.ctx)
		self.ctx = nil
	end
	if self.owns_device and self.dev ~= nil then
		M.release(self.dev)
	end
	self.dev = nil
end

---------------------------------------------------------------- tool helpers

-- Copy a texture to the CPU. Returns a byte buffer and its row pitch.
function Gpu:read_texture(tex)
	local desc = ffi.new("VfxTexture2DDesc", tex.w, tex.h, 1, 1, tex.format, 1, 0, USAGE_STAGING, 0, CPU_READ, 0)
	self:check(self.dev.vt.CreateTexture2D(self.dev, desc, nil, self.out), "CreateTexture2D(staging)")
	local staging = self.out[0]
	self:copy(staging, tex.res)
	local mapped = ffi.new("VfxMapped")
	local hr = self.ctx.vt.Map(self.ctx, staging, 0, MAP_READ, 0, mapped)
	if hr < 0 then
		M.release(staging)
		self:check(hr, "Map")
	end
	local pitch = mapped.RowPitch
	local bytes = ffi.new("uint8_t[?]", pitch * tex.h)
	ffi.copy(bytes, mapped.pData, pitch * tex.h)
	self.ctx.vt.Unmap(self.ctx, staging, 0)
	M.release(staging)
	return bytes, pitch
end

-- GPU stopwatch around a function, in milliseconds (blocks until done).
function Gpu:time(fn)
	local function query(kind)
		self:check(self.dev.vt.CreateQuery(self.dev, ffi.new("VfxQueryDesc", kind, 0), self.out), "CreateQuery")
		return self.out[0]
	end
	local disjoint, t0, t1 = query(QUERY_DISJOINT), query(QUERY_TIMESTAMP), query(QUERY_TIMESTAMP)
	local ctx = self.ctx
	ctx.vt.Begin(ctx, disjoint)
	ctx.vt.End(ctx, t0)
	fn()
	ctx.vt.End(ctx, t1)
	ctx.vt.End(ctx, disjoint)
	local dj = ffi.new("VfxDisjoint")
	while ctx.vt.GetData(ctx, disjoint, dj, ffi.sizeof(dj), 0) ~= 0 do
	end
	local a, b = ffi.new("uint64_t[1]"), ffi.new("uint64_t[1]")
	while ctx.vt.GetData(ctx, t0, a, 8, 0) ~= 0 do
	end
	while ctx.vt.GetData(ctx, t1, b, 8, 0) ~= 0 do
	end
	M.release(disjoint)
	M.release(t0)
	M.release(t1)
	if dj.Disjoint ~= 0 then
		return nil
	end
	return tonumber(b[0] - a[0]) / tonumber(dj.Frequency) * 1000
end

-- Drain debug-layer messages (only on devices made with create_device(true)).
function Gpu:messages()
	local list = {}
	if not self.debug then
		return list
	end
	if not self.iq then
		local iid = ffi.new("VfxGuid", 0x6543dbb6, 0x1b48, 0x42f5, { 0xab, 0x82, 0xe9, 0x7e, 0xc7, 0x43, 0x26, 0xf6 })
		local u = ffi.cast("VfxUnknown*", self.dev)
		if u.vt.QueryInterface(u, iid, self.out) < 0 then
			self.debug = false
			return list
		end
		self.iq = ffi.cast("VfxInfoQueue*", self.out[0])
	end
	local iq = self.iq
	local n = tonumber(iq.vt.GetNumStoredMessagesAllowedByRetrievalFilter(iq))
	local len = ffi.new("size_t[1]")
	for i = 0, n - 1 do
		iq.vt.GetMessage(iq, i, nil, len)
		local buf = ffi.new("uint8_t[?]", len[0])
		iq.vt.GetMessage(iq, i, buf, len)
		local m = ffi.cast("VfxMessage*", buf)
		list[#list + 1] = string.format("severity %d, id %d: %s", m.Severity, m.ID, ffi.string(m.pDescription))
	end
	iq.vt.ClearStoredMessages(iq)
	return list
end

return M
