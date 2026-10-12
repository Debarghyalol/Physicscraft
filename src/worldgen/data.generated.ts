// Generated bootstrap data for Minecraft overworld router. Run scripts/generate-worldgen-data.ts against the matching decompiler ZIP to expand every density/noise JSON.
// The compact checked-in settings below are sufficient for the named density graph's primary noises.
export const DENSITY_JSON: Record<string, any> = {
 "zero":{"type":"minecraft:constant","argument":0},
 "y":{"type":"minecraft:y"},
 "shift_x":{"type":"minecraft:cache","input":{"type":"minecraft:shift_a","noise":"minecraft:offset"}},
 "shift_z":{"type":"minecraft:cache","input":{"type":"minecraft:shift_b","noise":"minecraft:offset"}},
 "overworld/depth":{"type":"minecraft:add","left":{"type":"minecraft:gradient","axis":"y","from_coordinate":-64,"from_value":1.5,"to_coordinate":320,"to_value":-1.5},"right":"minecraft:overworld/offset"},
 "overworld/continents":{"type":"minecraft:noise","noise":"minecraft:continentalness","shift_x":"minecraft:shift_x","shift_z":"minecraft:shift_z","xz_scale":0.25,"y_scale":0},
 "overworld/erosion":{"type":"minecraft:noise","noise":"minecraft:erosion","shift_x":"minecraft:shift_x","shift_z":"minecraft:shift_z","xz_scale":0.25,"y_scale":0},
 "overworld/ridges":{"type":"minecraft:noise","noise":"minecraft:ridge","shift_x":"minecraft:shift_x","shift_z":"minecraft:shift_z","xz_scale":0.25,"y_scale":0},
 "overworld/ridges_folded":{"type":"minecraft:mul","left":{"type":"minecraft:add","left":{"type":"minecraft:abs","input":{"type":"minecraft:add","left":{"type":"minecraft:abs","input":"minecraft:overworld/ridges"},"right":-0.6666667}},"right":-0.33333334},"right":-3},
 "overworld/temperature":{"type":"minecraft:noise","noise":"minecraft:temperature","shift_x":"minecraft:shift_x","shift_z":"minecraft:shift_z","xz_scale":0.25,"y_scale":0},
 "overworld/vegetation":{"type":"minecraft:noise","noise":"minecraft:vegetation","shift_x":"minecraft:shift_x","shift_z":"minecraft:shift_z","xz_scale":0.25,"y_scale":0},
 "overworld/factor":{"type":"minecraft:constant","argument":1},
 "overworld/offset":{"type":"minecraft:constant","argument":0},
 "overworld/jaggedness":{"type":"minecraft:constant","argument":0},
 "overworld/sloped_cheese":{"type":"minecraft:old_blended_noise","smear_scale_multiplier":8,"xz_factor":80,"xz_scale":0.25,"y_factor":160,"y_scale":0.125},
 "overworld/base_3d_noise":{"type":"minecraft:old_blended_noise","smear_scale_multiplier":8,"xz_factor":80,"xz_scale":0.25,"y_factor":160,"y_scale":0.125},
 "overworld/final_density":{"type":"minecraft:add","left":{"type":"minecraft:min","left":{"type":"minecraft:squeeze","input":{"type":"minecraft:interpolated","cell_size_xz":4,"cell_size_y":8,"input":{"type":"minecraft:mul","left":{"type":"minecraft:blend_density","input":{"type":"minecraft:constant","argument":0.1171875}},"right":0.64}}},"right":"minecraft:overworld/caves/noodle"},
 "overworld/preliminary_surface_level":{"type":"minecraft:constant","argument":63},
 "overworld/chunk_surface_level":{"type":"minecraft:find_top_surface"}
};
export const NOISE_SETTINGS: Record<string, any> = {
 "continentalness":{"amplitude_modifiers":[1,1,2,2,2,1,1,1,1],"base_amplitude":0.8880832896205223,"base_octave":-9,"octave_count":9},
 "erosion":{"amplitude_modifiers":[1,1,0,1,1],"base_amplitude":1.063180125160734,"base_octave":-9,"octave_count":5},
 "ridge":{"amplitude_modifiers":[1,2,1,0,0,0],"base_amplitude":0.9147152149950137,"base_octave":-7,"octave_count":6},
 "temperature":{"amplitude_modifiers":[1.5,0,1,0,0,0],"base_amplitude":1.2453007926713473,"base_octave":-10,"octave_count":6},
 "vegetation":{"amplitude_modifiers":[1,1,0,0,0,0],"base_amplitude":0.9494731054427978,"base_octave":-8,"octave_count":6},
 "offset":{"amplitude_modifiers":[1,1,1,0],"base_amplitude":0.9381732587751005,"base_octave":-3,"octave_count":4},
 "jagged":{"base_amplitude":1.0383104856073737,"base_octave":-16,"octave_count":16},
 "cave_cheese":{"amplitude_modifiers":[0.5,1,2,1,2,1,0,2,0],"base_amplitude":0.8361300524356068,"base_octave":-8,"octave_count":9}
};
