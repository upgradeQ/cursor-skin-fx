-- Cursor VFX: Magic Particles
-- OBS Studio script (Windows, Direct3D 11 renderer). Load it under
-- Tools > Scripts, then add the "Cursor VFX: Magic Particles" source to a scene.

local root = script_path()
package.path = root .. "?.lua;" .. package.path

local host = require("vfx.host")
local effect = require("vfx.effects.magic")

function script_description()
	return host.description(effect)
end

function script_load()
	host.register(effect, root)
end

function script_unload()
	host.unload()
end
