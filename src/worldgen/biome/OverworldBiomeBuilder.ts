/**
 * Mechanically ported from net/minecraft/world/level/biome/OverworldBiomeBuilder.java (Minecraft 26.3).
 * Builds the vanilla overworld multi-noise biome parameter table (surface, underground, bottom biomes).
 * Biome ids are registry paths without the "minecraft:" namespace.
 */
import {Param,ParameterPoint,span,point,parameters} from './climate';
type Add=(p:ParameterPoint,biome:string)=>void;
export class OverworldBiomeBuilder {
  private readonly FULL_RANGE: Param = span(-1.0, 1.0);
  private readonly temperatures: Param[] = [span(-1.0, -0.45), span(-0.45, -0.15), span(-0.15, 0.2), span(0.2, 0.55), span(0.55, 1.0)];
  private readonly humidities: Param[] = [span(-1.0, -0.35), span(-0.35, -0.1), span(-0.1, 0.1), span(0.1, 0.3), span(0.3, 1.0)];
  private readonly erosions: Param[] = [span(-1.0, -0.78), span(-0.78, -0.375), span(-0.375, -0.2225), span(-0.2225, 0.05), span(0.05, 0.45), span(0.45, 0.55), span(0.55, 1.0)];
  private FROZEN_RANGE!: Param; private UNFROZEN_RANGE!: Param;
  private mushroomFieldsContinentalness!: Param; private deepOceanContinentalness!: Param; private oceanContinentalness!: Param;
  private coastContinentalness!: Param; private inlandContinentalness!: Param; private nearInlandContinentalness!: Param;
  private midInlandContinentalness!: Param; private farInlandContinentalness!: Param;
  private OCEANS!: string[][]; private MIDDLE_BIOMES!: string[][]; private MIDDLE_BIOMES_VARIANT!: string[][];
  private PLATEAU_BIOMES!: string[][]; private PLATEAU_BIOMES_VARIANT!: string[][]; private SHATTERED_BIOMES!: string[][];
  constructor() {
      this.FROZEN_RANGE = this.temperatures[0];
      this.UNFROZEN_RANGE = span(this.temperatures[1], this.temperatures[4]);
      this.mushroomFieldsContinentalness = span(-1.2, -1.05);
      this.deepOceanContinentalness = span(-1.05, -0.455);
      this.oceanContinentalness = span(-0.455, -0.19);
      this.coastContinentalness = span(-0.19, -0.11);
      this.inlandContinentalness = span(-0.11, 0.55);
      this.nearInlandContinentalness = span(-0.11, 0.03);
      this.midInlandContinentalness = span(0.03, 0.3);
      this.farInlandContinentalness = span(0.3, 1.0);
      this.OCEANS = [['deep_frozen_ocean', 'deep_cold_ocean', 'deep_ocean', 'deep_lukewarm_ocean', 'warm_ocean'], ['frozen_ocean', 'cold_ocean', 'ocean', 'lukewarm_ocean', 'warm_ocean']];
      this.MIDDLE_BIOMES = [['snowy_plains', 'snowy_plains', 'snowy_plains', 'snowy_taiga', 'taiga'], ['plains', 'plains', 'forest', 'taiga', 'old_growth_spruce_taiga'], ['flower_forest', 'plains', 'forest', 'birch_forest', 'dark_forest'], ['savanna', 'savanna', 'forest', 'jungle', 'jungle'], ['desert', 'desert', 'desert', 'desert', 'desert']];
      this.MIDDLE_BIOMES_VARIANT = [['ice_spikes', null as any, 'snowy_taiga', null as any, null as any], ['dappled_forest', null as any, null as any, null as any, 'old_growth_pine_taiga'], ['sunflower_plains', null as any, null as any, 'old_growth_birch_forest', null as any], [null as any, null as any, 'plains', 'sparse_jungle', 'bamboo_jungle'], [null as any, null as any, null as any, null as any, null as any]];
      this.PLATEAU_BIOMES = [['snowy_plains', 'snowy_plains', 'snowy_plains', 'snowy_taiga', 'snowy_taiga'], ['meadow', 'meadow', 'forest', 'taiga', 'old_growth_spruce_taiga'], ['meadow', 'meadow', 'meadow', 'meadow', 'pale_garden'], ['savanna_plateau', 'savanna_plateau', 'forest', 'forest', 'jungle'], ['badlands', 'badlands', 'badlands', 'wooded_badlands', 'wooded_badlands']];
      this.PLATEAU_BIOMES_VARIANT = [['ice_spikes', null as any, null as any, null as any, null as any], ['cherry_grove', null as any, 'meadow', 'meadow', 'old_growth_pine_taiga'], ['cherry_grove', 'cherry_grove', 'forest', 'birch_forest', null as any], [null as any, null as any, null as any, null as any, null as any], ['eroded_badlands', 'eroded_badlands', null as any, null as any, null as any]];
      this.SHATTERED_BIOMES = [['windswept_gravelly_hills', 'windswept_gravelly_hills', 'windswept_hills', 'windswept_forest', 'windswept_forest'], ['windswept_gravelly_hills', 'windswept_gravelly_hills', 'windswept_hills', 'windswept_forest', 'windswept_forest'], ['windswept_hills', 'windswept_hills', 'windswept_hills', 'windswept_forest', 'windswept_forest'], [null as any, null as any, null as any, null as any, null as any], [null as any, null as any, null as any, null as any, null as any]];
     }
  addBiomes(biomes: Add) {
    this.addOffCoastBiomes(biomes);
    this.addInlandBiomes(biomes);
    this.addUndergroundBiomes(biomes);
  }
  private addOffCoastBiomes(biomes: Add) {
      this.addSurfaceBiome(biomes, this.FULL_RANGE, this.FULL_RANGE, this.mushroomFieldsContinentalness, this.FULL_RANGE, this.FULL_RANGE, 0.0, 'mushroom_fields');
      for(let temperatureIndex = 0; temperatureIndex < this.temperatures.length; ++temperatureIndex) {
         const temperature = this.temperatures[temperatureIndex];
         this.addSurfaceBiome(biomes, temperature, this.FULL_RANGE, this.deepOceanContinentalness, this.FULL_RANGE, this.FULL_RANGE, 0.0, this.OCEANS[0][temperatureIndex]);
         this.addSurfaceBiome(biomes, temperature, this.FULL_RANGE, this.oceanContinentalness, this.FULL_RANGE, this.FULL_RANGE, 0.0, this.OCEANS[1][temperatureIndex]);
      }
   }
  private addInlandBiomes(biomes: Add) {
      this.addMidSlice(biomes, span(-1.0, -0.93333334));
      this.addHighSlice(biomes, span(-0.93333334, -0.7666667));
      this.addPeaks(biomes, span(-0.7666667, -0.56666666));
      this.addHighSlice(biomes, span(-0.56666666, -0.4));
      this.addMidSlice(biomes, span(-0.4, -0.26666668));
      this.addLowSlice(biomes, span(-0.26666668, -0.05));
      this.addValleys(biomes, span(-0.05, 0.05));
      this.addLowSlice(biomes, span(0.05, 0.26666668));
      this.addMidSlice(biomes, span(0.26666668, 0.4));
      this.addHighSlice(biomes, span(0.4, 0.56666666));
      this.addPeaks(biomes, span(0.56666666, 0.7666667));
      this.addHighSlice(biomes, span(0.7666667, 0.93333334));
      this.addMidSlice(biomes, span(0.93333334, 1.0));
   }
  private addPeaks(biomes: Add, weirdness: Param) {
      for(let temperatureIndex = 0; temperatureIndex < this.temperatures.length; ++temperatureIndex) {
         const temperature = this.temperatures[temperatureIndex];
         for(let humidityIndex = 0; humidityIndex < this.humidities.length; ++humidityIndex) {
            const humidity = this.humidities[humidityIndex];
            const middleBiome = this.pickMiddleBiome(temperatureIndex, humidityIndex, weirdness);
            const middleBiomeOrBadlandsIfHot = this.pickMiddleBiomeOrBadlandsIfHot(temperatureIndex, humidityIndex, weirdness);
            const middleBiomeOrBadlandsIfHotOrSlopeIfCold = this.pickMiddleBiomeOrBadlandsIfHotOrSlopeIfCold(temperatureIndex, humidityIndex, weirdness);
            const plateauBiome = this.pickPlateauBiome(temperatureIndex, humidityIndex, weirdness);
            const shatteredBiome = this.pickShatteredBiome(temperatureIndex, humidityIndex, weirdness);
            const shatteredBiomeOrWindsweptSavanna = this.maybePickWindsweptSavannaBiome(temperatureIndex, humidityIndex, weirdness, shatteredBiome);
            const peakBiome = this.pickPeakBiome(temperatureIndex, humidityIndex, weirdness);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.coastContinentalness, this.farInlandContinentalness), this.erosions[0], weirdness, 0.0, peakBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.coastContinentalness, this.nearInlandContinentalness), this.erosions[1], weirdness, 0.0, middleBiomeOrBadlandsIfHotOrSlopeIfCold);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.midInlandContinentalness, this.farInlandContinentalness), this.erosions[1], weirdness, 0.0, peakBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.coastContinentalness, this.nearInlandContinentalness), span(this.erosions[2], this.erosions[3]), weirdness, 0.0, middleBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.midInlandContinentalness, this.farInlandContinentalness), this.erosions[2], weirdness, 0.0, plateauBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, this.midInlandContinentalness, this.erosions[3], weirdness, 0.0, middleBiomeOrBadlandsIfHot);
            this.addSurfaceBiome(biomes, temperature, humidity, this.farInlandContinentalness, this.erosions[3], weirdness, 0.0, plateauBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.coastContinentalness, this.farInlandContinentalness), this.erosions[4], weirdness, 0.0, middleBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.coastContinentalness, this.nearInlandContinentalness), this.erosions[5], weirdness, 0.0, shatteredBiomeOrWindsweptSavanna);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.midInlandContinentalness, this.farInlandContinentalness), this.erosions[5], weirdness, 0.0, shatteredBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.coastContinentalness, this.farInlandContinentalness), this.erosions[6], weirdness, 0.0, middleBiome);
         }
      }
   }
  private addHighSlice(biomes: Add, weirdness: Param) {
      for(let temperatureIndex = 0; temperatureIndex < this.temperatures.length; ++temperatureIndex) {
         const temperature = this.temperatures[temperatureIndex];
         for(let humidityIndex = 0; humidityIndex < this.humidities.length; ++humidityIndex) {
            const humidity = this.humidities[humidityIndex];
            const middleBiome = this.pickMiddleBiome(temperatureIndex, humidityIndex, weirdness);
            const middleBiomeOrBadlandsIfHot = this.pickMiddleBiomeOrBadlandsIfHot(temperatureIndex, humidityIndex, weirdness);
            const middleBiomeOrBadlandsIfHotOrSlopeIfCold = this.pickMiddleBiomeOrBadlandsIfHotOrSlopeIfCold(temperatureIndex, humidityIndex, weirdness);
            const plateauBiome = this.pickPlateauBiome(temperatureIndex, humidityIndex, weirdness);
            const shatteredBiome = this.pickShatteredBiome(temperatureIndex, humidityIndex, weirdness);
            const middleBiomeOrWindsweptSavanna = this.maybePickWindsweptSavannaBiome(temperatureIndex, humidityIndex, weirdness, middleBiome);
            const slopeBiome = this.pickSlopeBiome(temperatureIndex, humidityIndex, weirdness);
            const peakBiome = this.pickPeakBiome(temperatureIndex, humidityIndex, weirdness);
            this.addSurfaceBiome(biomes, temperature, humidity, this.coastContinentalness, span(this.erosions[0], this.erosions[1]), weirdness, 0.0, middleBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, this.nearInlandContinentalness, this.erosions[0], weirdness, 0.0, slopeBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.midInlandContinentalness, this.farInlandContinentalness), this.erosions[0], weirdness, 0.0, peakBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, this.nearInlandContinentalness, this.erosions[1], weirdness, 0.0, middleBiomeOrBadlandsIfHotOrSlopeIfCold);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.midInlandContinentalness, this.farInlandContinentalness), this.erosions[1], weirdness, 0.0, slopeBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.coastContinentalness, this.nearInlandContinentalness), span(this.erosions[2], this.erosions[3]), weirdness, 0.0, middleBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.midInlandContinentalness, this.farInlandContinentalness), this.erosions[2], weirdness, 0.0, plateauBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, this.midInlandContinentalness, this.erosions[3], weirdness, 0.0, middleBiomeOrBadlandsIfHot);
            this.addSurfaceBiome(biomes, temperature, humidity, this.farInlandContinentalness, this.erosions[3], weirdness, 0.0, plateauBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.coastContinentalness, this.farInlandContinentalness), this.erosions[4], weirdness, 0.0, middleBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.coastContinentalness, this.nearInlandContinentalness), this.erosions[5], weirdness, 0.0, middleBiomeOrWindsweptSavanna);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.midInlandContinentalness, this.farInlandContinentalness), this.erosions[5], weirdness, 0.0, shatteredBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.coastContinentalness, this.farInlandContinentalness), this.erosions[6], weirdness, 0.0, middleBiome);
         }
      }
   }
  private addMidSlice(biomes: Add, weirdness: Param) {
      this.addSurfaceBiome(biomes, this.FULL_RANGE, this.FULL_RANGE, this.coastContinentalness, span(this.erosions[0], this.erosions[2]), weirdness, 0.0, 'stony_shore');
      this.addSurfaceBiome(biomes, span(this.temperatures[1], this.temperatures[2]), this.FULL_RANGE, span(this.nearInlandContinentalness, this.farInlandContinentalness), this.erosions[6], weirdness, 0.0, 'swamp');
      this.addSurfaceBiome(biomes, span(this.temperatures[3], this.temperatures[4]), this.FULL_RANGE, span(this.nearInlandContinentalness, this.farInlandContinentalness), this.erosions[6], weirdness, 0.0, 'mangrove_swamp');
      for(let temperatureIndex = 0; temperatureIndex < this.temperatures.length; ++temperatureIndex) {
         const temperature = this.temperatures[temperatureIndex];
         for(let humidityIndex = 0; humidityIndex < this.humidities.length; ++humidityIndex) {
            const humidity = this.humidities[humidityIndex];
            const middleBiome = this.pickMiddleBiome(temperatureIndex, humidityIndex, weirdness);
            const middleBiomeOrBadlandsIfHot = this.pickMiddleBiomeOrBadlandsIfHot(temperatureIndex, humidityIndex, weirdness);
            const middleBiomeOrBadlandsIfHotOrSlopeIfCold = this.pickMiddleBiomeOrBadlandsIfHotOrSlopeIfCold(temperatureIndex, humidityIndex, weirdness);
            const shatteredBiome = this.pickShatteredBiome(temperatureIndex, humidityIndex, weirdness);
            const plateauBiome = this.pickPlateauBiome(temperatureIndex, humidityIndex, weirdness);
            const beachBiome = this.pickBeachBiome(temperatureIndex, humidityIndex);
            const middleBiomeOrWindsweptSavanna = this.maybePickWindsweptSavannaBiome(temperatureIndex, humidityIndex, weirdness, middleBiome);
            const shatteredCoastBiome = this.pickShatteredCoastBiome(temperatureIndex, humidityIndex, weirdness);
            const slopeBiome = this.pickSlopeBiome(temperatureIndex, humidityIndex, weirdness);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.nearInlandContinentalness, this.farInlandContinentalness), this.erosions[0], weirdness, 0.0, slopeBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.nearInlandContinentalness, this.midInlandContinentalness), this.erosions[1], weirdness, 0.0, middleBiomeOrBadlandsIfHotOrSlopeIfCold);
            this.addSurfaceBiome(biomes, temperature, humidity, this.farInlandContinentalness, this.erosions[1], weirdness, 0.0, temperatureIndex == 0 ? slopeBiome : plateauBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, this.nearInlandContinentalness, this.erosions[2], weirdness, 0.0, middleBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, this.midInlandContinentalness, this.erosions[2], weirdness, 0.0, middleBiomeOrBadlandsIfHot);
            this.addSurfaceBiome(biomes, temperature, humidity, this.farInlandContinentalness, this.erosions[2], weirdness, 0.0, plateauBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.coastContinentalness, this.nearInlandContinentalness), this.erosions[3], weirdness, 0.0, middleBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.midInlandContinentalness, this.farInlandContinentalness), this.erosions[3], weirdness, 0.0, middleBiomeOrBadlandsIfHot);
            if (weirdness.max < 0) {
               this.addSurfaceBiome(biomes, temperature, humidity, this.coastContinentalness, this.erosions[4], weirdness, 0.0, beachBiome);
               this.addSurfaceBiome(biomes, temperature, humidity, span(this.nearInlandContinentalness, this.farInlandContinentalness), this.erosions[4], weirdness, 0.0, middleBiome);
            } else {
               this.addSurfaceBiome(biomes, temperature, humidity, span(this.coastContinentalness, this.farInlandContinentalness), this.erosions[4], weirdness, 0.0, middleBiome);
            }
            this.addSurfaceBiome(biomes, temperature, humidity, this.coastContinentalness, this.erosions[5], weirdness, 0.0, shatteredCoastBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, this.nearInlandContinentalness, this.erosions[5], weirdness, 0.0, middleBiomeOrWindsweptSavanna);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.midInlandContinentalness, this.farInlandContinentalness), this.erosions[5], weirdness, 0.0, shatteredBiome);
            if (weirdness.max < 0) {
               this.addSurfaceBiome(biomes, temperature, humidity, this.coastContinentalness, this.erosions[6], weirdness, 0.0, beachBiome);
            } else {
               this.addSurfaceBiome(biomes, temperature, humidity, this.coastContinentalness, this.erosions[6], weirdness, 0.0, middleBiome);
            }
            if (temperatureIndex == 0) {
               this.addSurfaceBiome(biomes, temperature, humidity, span(this.nearInlandContinentalness, this.farInlandContinentalness), this.erosions[6], weirdness, 0.0, middleBiome);
            }
         }
      }
   }
  private addLowSlice(biomes: Add, weirdness: Param) {
      this.addSurfaceBiome(biomes, this.FULL_RANGE, this.FULL_RANGE, this.coastContinentalness, span(this.erosions[0], this.erosions[2]), weirdness, 0.0, 'stony_shore');
      this.addSurfaceBiome(biomes, span(this.temperatures[1], this.temperatures[2]), this.FULL_RANGE, span(this.nearInlandContinentalness, this.farInlandContinentalness), this.erosions[6], weirdness, 0.0, 'swamp');
      this.addSurfaceBiome(biomes, span(this.temperatures[3], this.temperatures[4]), this.FULL_RANGE, span(this.nearInlandContinentalness, this.farInlandContinentalness), this.erosions[6], weirdness, 0.0, 'mangrove_swamp');
      for(let temperatureIndex = 0; temperatureIndex < this.temperatures.length; ++temperatureIndex) {
         const temperature = this.temperatures[temperatureIndex];
         for(let humidityIndex = 0; humidityIndex < this.humidities.length; ++humidityIndex) {
            const humidity = this.humidities[humidityIndex];
            const middleBiome = this.pickMiddleBiome(temperatureIndex, humidityIndex, weirdness);
            const middleBiomeOrBadlandsIfHot = this.pickMiddleBiomeOrBadlandsIfHot(temperatureIndex, humidityIndex, weirdness);
            const middleBiomeOrBadlandsIfHotOrSlopeIfCold = this.pickMiddleBiomeOrBadlandsIfHotOrSlopeIfCold(temperatureIndex, humidityIndex, weirdness);
            const beachBiome = this.pickBeachBiome(temperatureIndex, humidityIndex);
            const middleBiomeOrWindsweptSavanna = this.maybePickWindsweptSavannaBiome(temperatureIndex, humidityIndex, weirdness, middleBiome);
            const shatteredCoastBiome = this.pickShatteredCoastBiome(temperatureIndex, humidityIndex, weirdness);
            this.addSurfaceBiome(biomes, temperature, humidity, this.nearInlandContinentalness, span(this.erosions[0], this.erosions[1]), weirdness, 0.0, middleBiomeOrBadlandsIfHot);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.midInlandContinentalness, this.farInlandContinentalness), span(this.erosions[0], this.erosions[1]), weirdness, 0.0, middleBiomeOrBadlandsIfHotOrSlopeIfCold);
            this.addSurfaceBiome(biomes, temperature, humidity, this.nearInlandContinentalness, span(this.erosions[2], this.erosions[3]), weirdness, 0.0, middleBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.midInlandContinentalness, this.farInlandContinentalness), span(this.erosions[2], this.erosions[3]), weirdness, 0.0, middleBiomeOrBadlandsIfHot);
            this.addSurfaceBiome(biomes, temperature, humidity, this.coastContinentalness, span(this.erosions[3], this.erosions[4]), weirdness, 0.0, beachBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.nearInlandContinentalness, this.farInlandContinentalness), this.erosions[4], weirdness, 0.0, middleBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, this.coastContinentalness, this.erosions[5], weirdness, 0.0, shatteredCoastBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, this.nearInlandContinentalness, this.erosions[5], weirdness, 0.0, middleBiomeOrWindsweptSavanna);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.midInlandContinentalness, this.farInlandContinentalness), this.erosions[5], weirdness, 0.0, middleBiome);
            this.addSurfaceBiome(biomes, temperature, humidity, this.coastContinentalness, this.erosions[6], weirdness, 0.0, beachBiome);
            if (temperatureIndex == 0) {
               this.addSurfaceBiome(biomes, temperature, humidity, span(this.nearInlandContinentalness, this.farInlandContinentalness), this.erosions[6], weirdness, 0.0, middleBiome);
            }
         }
      }
   }
  private addValleys(biomes: Add, weirdness: Param) {
      this.addSurfaceBiome(biomes, this.FROZEN_RANGE, this.FULL_RANGE, this.coastContinentalness, span(this.erosions[0], this.erosions[1]), weirdness, 0.0, weirdness.max < 0 ? 'stony_shore' : 'frozen_river');
      this.addSurfaceBiome(biomes, this.UNFROZEN_RANGE, this.FULL_RANGE, this.coastContinentalness, span(this.erosions[0], this.erosions[1]), weirdness, 0.0, weirdness.max < 0 ? 'stony_shore' : 'river');
      this.addSurfaceBiome(biomes, this.FROZEN_RANGE, this.FULL_RANGE, this.nearInlandContinentalness, span(this.erosions[0], this.erosions[1]), weirdness, 0.0, 'frozen_river');
      this.addSurfaceBiome(biomes, this.UNFROZEN_RANGE, this.FULL_RANGE, this.nearInlandContinentalness, span(this.erosions[0], this.erosions[1]), weirdness, 0.0, 'river');
      this.addSurfaceBiome(biomes, this.FROZEN_RANGE, this.FULL_RANGE, span(this.coastContinentalness, this.farInlandContinentalness), span(this.erosions[2], this.erosions[5]), weirdness, 0.0, 'frozen_river');
      this.addSurfaceBiome(biomes, this.UNFROZEN_RANGE, this.FULL_RANGE, span(this.coastContinentalness, this.farInlandContinentalness), span(this.erosions[2], this.erosions[5]), weirdness, 0.0, 'river');
      this.addSurfaceBiome(biomes, this.FROZEN_RANGE, this.FULL_RANGE, this.coastContinentalness, this.erosions[6], weirdness, 0.0, 'frozen_river');
      this.addSurfaceBiome(biomes, this.UNFROZEN_RANGE, this.FULL_RANGE, this.coastContinentalness, this.erosions[6], weirdness, 0.0, 'river');
      this.addSurfaceBiome(biomes, span(this.temperatures[1], this.temperatures[2]), this.FULL_RANGE, span(this.inlandContinentalness, this.farInlandContinentalness), this.erosions[6], weirdness, 0.0, 'swamp');
      this.addSurfaceBiome(biomes, span(this.temperatures[3], this.temperatures[4]), this.FULL_RANGE, span(this.inlandContinentalness, this.farInlandContinentalness), this.erosions[6], weirdness, 0.0, 'mangrove_swamp');
      this.addSurfaceBiome(biomes, this.FROZEN_RANGE, this.FULL_RANGE, span(this.inlandContinentalness, this.farInlandContinentalness), this.erosions[6], weirdness, 0.0, 'frozen_river');
      for(let temperatureIndex = 0; temperatureIndex < this.temperatures.length; ++temperatureIndex) {
         const temperature = this.temperatures[temperatureIndex];
         for(let humidityIndex = 0; humidityIndex < this.humidities.length; ++humidityIndex) {
            const humidity = this.humidities[humidityIndex];
            const middleBiomeOrBadlandsIfHot = this.pickMiddleBiomeOrBadlandsIfHot(temperatureIndex, humidityIndex, weirdness);
            this.addSurfaceBiome(biomes, temperature, humidity, span(this.midInlandContinentalness, this.farInlandContinentalness), span(this.erosions[0], this.erosions[1]), weirdness, 0.0, middleBiomeOrBadlandsIfHot);
         }
      }
   }
  private addUndergroundBiomes(biomes: Add) {
      this.addUndergroundBiome(biomes, this.FULL_RANGE, this.FULL_RANGE, span(0.8, 1.0), this.FULL_RANGE, this.FULL_RANGE, 0.0, 'dripstone_caves');
      this.addUndergroundBiome(biomes, this.FULL_RANGE, span(0.7, 1.0), this.FULL_RANGE, this.FULL_RANGE, this.FULL_RANGE, 0.0, 'lush_caves');
      this.addUndergroundBiome(biomes, this.FULL_RANGE, this.FULL_RANGE, span(this.coastContinentalness, this.inlandContinentalness), span(this.erosions[5], this.erosions[6]), span(-1.1, -0.85), 0.0, 'sulfur_caves');
      this.addBottomBiome(biomes, this.FULL_RANGE, this.FULL_RANGE, this.FULL_RANGE, span(this.erosions[0], this.erosions[1]), this.FULL_RANGE, 0.0, 'deep_dark');
   }
  private pickMiddleBiome(temperatureIndex: number, humidityIndex: number, weirdness: Param): string {
      if (weirdness.max < 0) {
         return this.MIDDLE_BIOMES[temperatureIndex][humidityIndex];
      } else {
         const variant = this.MIDDLE_BIOMES_VARIANT[temperatureIndex][humidityIndex];
         return variant == null ? this.MIDDLE_BIOMES[temperatureIndex][humidityIndex] : variant;
      }
   }
  private pickMiddleBiomeOrBadlandsIfHot(temperatureIndex: number, humidityIndex: number, weirdness: Param): string {
      return temperatureIndex == 4 ? this.pickBadlandsBiome(humidityIndex, weirdness) : this.pickMiddleBiome(temperatureIndex, humidityIndex, weirdness);
   }
  private pickMiddleBiomeOrBadlandsIfHotOrSlopeIfCold(temperatureIndex: number, humidityIndex: number, weirdness: Param): string {
      return temperatureIndex == 0 ? this.pickSlopeBiome(temperatureIndex, humidityIndex, weirdness) : this.pickMiddleBiomeOrBadlandsIfHot(temperatureIndex, humidityIndex, weirdness);
   }
  private maybePickWindsweptSavannaBiome(temperatureIndex: number, humidityIndex: number, weirdness: Param, underlyingBiome: string): string {
      return temperatureIndex > 1 && humidityIndex < 4 && weirdness.max >= 0 ? 'windswept_savanna' : underlyingBiome;
   }
  private pickShatteredCoastBiome(temperatureIndex: number, humidityIndex: number, weirdness: Param): string {
      const beachOrMiddleBiome = weirdness.max >= 0 ? this.pickMiddleBiome(temperatureIndex, humidityIndex, weirdness) : this.pickBeachBiome(temperatureIndex, humidityIndex);
      return this.maybePickWindsweptSavannaBiome(temperatureIndex, humidityIndex, weirdness, beachOrMiddleBiome);
   }
  private pickBeachBiome(temperatureIndex: number, humidityIndex: number): string {
      if (temperatureIndex == 0) {
         return 'snowy_beach';
      } else {
         return temperatureIndex == 4 ? 'desert' : 'beach';
      }
   }
  private pickBadlandsBiome(humidityIndex: number, weirdness: Param): string {
      if (humidityIndex < 2) {
         return weirdness.max < 0 ? 'badlands' : 'eroded_badlands';
      } else {
         return humidityIndex < 3 ? 'badlands' : 'wooded_badlands';
      }
   }
  private pickPlateauBiome(temperatureIndex: number, humidityIndex: number, weirdness: Param): string {
      if (weirdness.max >= 0) {
         const variant = this.PLATEAU_BIOMES_VARIANT[temperatureIndex][humidityIndex];
         if (variant != null) {
            return variant;
         }
      }
      return this.PLATEAU_BIOMES[temperatureIndex][humidityIndex];
   }
  private pickPeakBiome(temperatureIndex: number, humidityIndex: number, weirdness: Param): string {
      if (temperatureIndex <= 2) {
         return weirdness.max < 0 ? 'jagged_peaks' : 'frozen_peaks';
      } else {
         return temperatureIndex == 3 ? 'stony_peaks' : this.pickBadlandsBiome(humidityIndex, weirdness);
      }
   }
  private pickSlopeBiome(temperatureIndex: number, humidityIndex: number, weirdness: Param): string {
      if (temperatureIndex >= 3) {
         return this.pickPlateauBiome(temperatureIndex, humidityIndex, weirdness);
      } else {
         return humidityIndex <= 1 ? 'snowy_slopes' : 'grove';
      }
   }
  private pickShatteredBiome(temperatureIndex: number, humidityIndex: number, weirdness: Param): string {
      const biome = this.SHATTERED_BIOMES[temperatureIndex][humidityIndex];
      return biome == null ? this.pickMiddleBiome(temperatureIndex, humidityIndex, weirdness) : biome;
   }
  private addSurfaceBiome(biomes: Add, temperature: Param, humidity: Param, continentalness: Param, erosion: Param, weirdness: Param, offset: number, second: string) {
      biomes(parameters(temperature, humidity, continentalness, erosion, point(0.0), weirdness, offset), second); 
      biomes(parameters(temperature, humidity, continentalness, erosion, point(1.0), weirdness, offset), second); 
   }
  private addUndergroundBiome(biomes: Add, temperature: Param, humidity: Param, continentalness: Param, erosion: Param, weirdness: Param, offset: number, biome: string) {
      biomes(parameters(temperature, humidity, continentalness, erosion, span(0.2, 0.9), weirdness, offset), biome); 
   }
  private addBottomBiome(biomes: Add, temperature: Param, humidity: Param, continentalness: Param, erosion: Param, weirdness: Param, offset: number, biome: string) {
      biomes(parameters(temperature, humidity, continentalness, erosion, point(1.1), weirdness, offset), biome); 
   }
}

let cached: Array<[ParameterPoint, string]> | undefined;
/** The full overworld parameter list (cached; ~1000 points). */
export function overworldBiomeParameters(): Array<[ParameterPoint, string]> {
  if (!cached) { const list: Array<[ParameterPoint, string]> = []; new OverworldBiomeBuilder().addBiomes((p, b) => list.push([p, b])); cached = list; }
  return cached;
}
