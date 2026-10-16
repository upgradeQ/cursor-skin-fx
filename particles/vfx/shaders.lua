-- Loads the HLSL sources of an effect and compiles its compute kernels,
-- keeping the bytecode in a small on-disk cache so OBS starts fast.

local ffi = require("ffi")
local bit = require("bit")
local d3d = require("vfx.d3d11")

ffi.cdef[[
int CreateDirectoryA(const char *path, void *security);
]]

local M = {}

local function read_file(path)
	local f = io.open(path, "rb")
	if not f then
		return nil
	end
	local s = f:read("*a")
	f:close()
	return s
end

-- 32-bit FNV-1a (x * 16777619 mod 2^32 is split so doubles stay exact).
local function fnv1a(s)
	local h = 0x811C9DC5
	for i = 1, #s do
		h = bit.bxor(h, s:byte(i))
		h = bit.tobit(bit.lshift(h, 24) + h * 403)
	end
	return bit.tohex(h)
end

-- Join the files in order; #line keeps compiler messages pointing at the
-- right file and line.
function M.source(dir, files)
	local parts = {}
	for _, name in ipairs(files) do
		local text = read_file(dir .. name)
		if not text then
			error("cannot read shader " .. dir .. name, 2)
		end
		parts[#parts + 1] = string.format('#line 1 "%s"\n%s\n', name, text)
	end
	return table.concat(parts)
end

-- Returns { [entry] = bytecode } or nil, error. cache_dir may be nil.
function M.build(dir, cache_dir, files, entries)
	local src = M.source(dir, files)
	local key = fnv1a(src)
	if cache_dir then
		ffi.C.CreateDirectoryA(cache_dir, nil)
	end
	local out = {}
	for _, entry in ipairs(entries) do
		local path = cache_dir and string.format("%s%s-%s.cso", cache_dir, entry, key)
		local bytes = path and read_file(path)
		if not bytes or #bytes == 0 then
			local err
			bytes, err = d3d.compile(src, entry, files[#files])
			if not bytes then
				return nil, string.format("%s: %s", entry, tostring(err))
			end
			if path then
				local f = io.open(path, "wb")
				if f then
					f:write(bytes)
					f:close()
				end
			end
		end
		out[entry] = bytes
	end
	return out
end

return M
