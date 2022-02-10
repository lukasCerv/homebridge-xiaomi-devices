import { Network } from './network/network';
import { convertHomeKitColorTemperatureToHomeKitColor } from './colortools';

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// PowerMode:
// 0: Normal turn on operation(default value)
// 1: Turn on and switch to CT mode.   (used for white lights)
// 2: Turn on and switch to RGB mode.  (never used here)
// 3: Turn on and switch to HSV mode.  (used for color lights)
// 4: Turn on and switch to color flow mode.
// 5: Turn on and switch to Night light mode. (Ceiling light only).

const POWERMODE_NORMAL = 0;
const POWERMODE_CT = 1;
const POWERMODE_MOON = 5;

/*const ACTIVEMODE_DAYLIGHT = 0;
const ACTIVEMODE_MOON = 1;*/

const TRANSITION_DURATION = 0; // 30+

// ColorMode:
// 1 means color mode, (rgb -- never used here)
// 2 means color temperature mode, (CT used for white light)
// 3 means HSV mode (used for color lights)

/*const EMPTY_ATTRIBUTES = {
    power: false,
    color_mode: 0,
    bright: 0,
    hue: 0,
    sat: 0,
    ct: 0,
    bg_power: false,
    bg_bright: 0,
    bg_hue: 0,
    bg_sat: 0,
    bg_ct: 0,
    bg_lmode: 0,
    nl_br: 0, // brightness of night mode
    active_mode: 0, // 0: daylight mode / 1: moonlight mode (ceiling light only)
    name: "unknown",
};*/

type StrNumBoolObject = {[key: string]: string|number|boolean|null};

abstract class XiaomiDevice {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private networkRef: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private deviceAPI: any;
  private network: Network;

  protected logger: (error: string) => void;

  protected properties: StrNumBoolObject = {};

  constructor(logger: (error: string) => void) {
    this.network = new Network(logger);
    this.logger = logger;
  }

  async connect(address: string, token: string) {
    const handle = this.network.ref();

    try{
      this.deviceAPI = await this.network.findDeviceViaAddress({address, token});
      this.networkRef = this.network.ref();
      await this.getProperties();
    } catch(e){
      handle.release();
      throw e;
    }

    handle.release();
  }

  async getProperties(keys = Object.keys(this.properties)) {
    const props = await this.call('get_prop', keys);
    if(props) {
      for(let i = 0; i < keys.length; i++) {
        this.properties[keys[i]] = props[i];
      }
    }
  }

  async call(method: string, params: {[key: number]: string|number|StrNumBoolObject}|StrNumBoolObject = []) {
    if(!this.deviceAPI) {
      return;
    }
    try {
      return await this.deviceAPI.call(method, params);
    } catch(e: unknown) {
      this.logger(e as string);
    }
  }
}

export class AirPurifierDevice extends XiaomiDevice {
  protected properties:StrNumBoolObject = {
    mode: null,
    favorite_level: null,
    temp_dec: null,
    humidity: null,
    aqi: null,
    filter1_life: null,
  };

  lastMode = AirPurifierDevice.MODE_AUTO;
  private nightMode = false;

  static MODE_AUTO = 'auto';
  static MODE_SILENT = 'silent';
  static MODE_IDLE = 'idle';
  static MODE_FAVORITE = 'favorite';

  async setMode(value: string) {
    if(value !== AirPurifierDevice.MODE_IDLE) {
      this.lastMode = value;
    }
    this.properties.mode = value;
    await this.call('set_mode', [value]);
  }

  getMode() {
    return this.properties.mode;
  }

  async setFavoriteLevel(value: number) {
    const lev = Math.round(value/100*16);
    this.properties.favorite_level = lev;
    await this.call('set_level_favorite', [lev]);
  }

  getFavoriteLevel() {
    return Math.round(this.properties.favorite_level as number/16*100);
  }

  isNightMode() {
    return this.nightMode;
  }

  getTemperature() {
    return this.properties.temp_dec as number*1.0/10;
  }

  getHumidity() {
    return this.properties.humidity;
  }

  getAQI() {
    return this.properties.aqi;
  }

  getFilterLife() {
    return this.properties.filter1_life;
  }

  async setNightMode(mode: boolean) {
    if(this.nightMode === mode) {
      return;
    }
    this.nightMode = mode;
    if(mode && this.properties.mode === AirPurifierDevice.MODE_AUTO) {
      await this.setMode(AirPurifierDevice.MODE_SILENT);
    }
    if(!mode && this.properties.mode === AirPurifierDevice.MODE_SILENT) {
      await this.setMode(AirPurifierDevice.MODE_AUTO);
    }
    if(mode) {
      await this.call('set_led_b', [1]);
    }
    if(!mode) {
      await this.call('set_led_b', [0]);
    }
  }
}

export class VacuumDevice extends XiaomiDevice {
  protected properties:StrNumBoolObject = {
    state: null,
    error_code: null,
    battery: null,
    fan_speed: null,
    water_level: null,
  };

  static STATE = {
    IDLE: 1,
    CLEANING: 2,
    PAUSE: 3,
    ERROR: 4,
    CHARGING: 5,
    GO_CHARGING: 6,
  };

  static ERROR = {
    0: 'No error',
    1: 'Left Wheel stuck',
    2: 'Right Wheel stuck',
    3: 'Cliff error',
    4: 'Low battery',
    5: 'Bump error',
    6: 'Main Brush Error',
    7: 'Side Brush Error',
    8: 'Fan Motor Error',
    9: 'Dustbin Error',
    10: 'Charging Error',
    11: 'No Water Error',
    12: 'Pick Up Error',
  };

  static FAN_SPEED = {
    SILENT: 0,
    STANDARD: 1,
    MEDIUM: 2,
    HIGH: 3,
  };

  async getProperties() {
    const properties = await this.call('get_properties', [
      {'did': 'state', 'siid': 2, 'piid': 1},
      {'did': 'error_code', 'siid': 2, 'piid': 2},
      {'did': 'battery', 'siid': 3, 'piid': 1},
      {'did': 'fan_speed', 'siid': 2, 'piid': 6},
      {'did': 'water_level', 'siid': 2, 'piid': 5},
    ]);
    if(properties) {
      this.properties.state = properties.find(prop => prop.did === 'state').value;
      this.properties.error_code = properties.find(prop => prop.did === 'error_code').value;
      this.properties.battery = properties.find(prop => prop.did === 'battery').value;
      this.properties.fan_speed = properties.find(prop => prop.did === 'fan_speed').value;
      this.properties.water_level = properties.find(prop => prop.did === 'water_level').value;
    }
  }

  async setCleaning(value: boolean) {
    this.properties.state = value ? VacuumDevice.STATE.CLEANING : VacuumDevice.STATE.GO_CHARGING;
    await this.call('action', (value ? {'did': 'start', 'siid': 2, 'aiid': 1} : {'did': 'home', 'siid': 2, 'aiid': 3}));
  }

  getState() {
    return this.properties.state;
  }

  getBattery() {
    return this.properties.battery;
  }

  isBatteryLow() {
    return this.properties.error_code === 4;
  }

  getFanSpeed() {
    return this.properties.fan_speed as number * 25 + 25;
  }

  async setFanSpeed(speed: number) {
    const spd = Math.floor((speed - 25)/25);
    this.properties.fan_speed = spd;
    await this.call('set_properties', [{'did': 'fan_speed', 'siid': 2, 'piid': 6, 'value': spd}]);
  }

  getWaterLevel() {
    return this.properties.water_level as number * 25 + 25;
  }

  async setWaterLevel(level: number) {
    const lev = Math.floor((level - 25)/25);
    this.properties.water_level = lev;
    await this.call('set_properties', [{'did': 'water_level', 'siid': 2, 'piid': 5, 'value': lev}]);
  }
}

export class YeelightDevice extends XiaomiDevice {
  protected properties:StrNumBoolObject = {
    power: null,
    bright: null,
    ct: null,
  };

  async setPower(value: boolean) {
    const power = value ? 'on' : 'off';
    this.properties.power = power;
    await this.call('set_power', [power, (TRANSITION_DURATION ? 'smooth' : 'sudden'), TRANSITION_DURATION, this.getPowerMode()]);
  }

  getPower() {
    return this.properties.power === 'on';
  }

  protected getPowerMode():number {
    return POWERMODE_NORMAL;
  }

  async setBrightness(value: number) {
    value === value;
  }

  getBrightness():number {
    return 0;
  }

  async setColorTemperature(value: number) {
    if(!this.getPower()) {
      return;
    }
    this.properties.ct = value;
    await this.call('set_ct_abx', [value, (TRANSITION_DURATION ? 'smooth' : 'sudden'), TRANSITION_DURATION]);
  }

  getColorTemperature() {
    return this.properties.ct;
  }
}

export class CtMoonDevice extends YeelightDevice {
  protected properties:StrNumBoolObject = {
    power: null,
    bright: null,
    nl_br: null,
    ct: null,
  };

  private nightMode = false;
  private globalBright = 0;
  private tempCT = 0;
  private tempBright = 0;

  protected getPowerMode(): number {
    return this.nightMode ? POWERMODE_MOON : POWERMODE_CT;
  }

  async getProperties(keys?: string[]): Promise<void> {
    await super.getProperties(keys);
    if(this.getPower()) {
      this.globalBright = parseInt(this.nightMode ? this.properties.nl_br as string : this.properties.bright as string);
    }
  }

  async setMoonMode(mode: boolean) {
    if(this.nightMode === mode) {
      return;
    }

    this.nightMode = mode;
    this.tempBright = this.globalBright;

    if(!this.getPower()) {
      return;
    }

    await this.setPower(true);
  }

  async setPower(value: boolean): Promise<void> {
    await super.setPower(value);
    await sleep(100);
    if(value && this.tempBright) {
      await this.setBrightness(this.tempBright);
    }
    if(value && this.tempCT) {
      await this.setColorTemperature(this.tempCT);
    }
  }

  async setBrightness(value: number) {
    this.globalBright = value;
    if(!this.getPower()) {
      this.tempBright = value;
      return;
    }
    this.tempBright = 0;
    await this.call('set_bright', [value, (TRANSITION_DURATION ? 'smooth' : 'sudden'), TRANSITION_DURATION]);
  }

  getBrightness() {
    return (this.tempBright ? this.tempBright : this.globalBright);
  }

  async setColorTemperature(value: number) {
    if(this.nightMode || !this.getPower()) {
      this.tempCT = value;
      return;
    }
    this.tempCT = 0;
    await super.setColorTemperature(value);
  }

  getColorTemperature() {
    return (this.tempCT ? this.tempCT : this.properties.ct);
  }
}

export class ColorDevice extends YeelightDevice {
  protected properties:StrNumBoolObject = {
    power: null,
    bright: null,
    ct: null,
    hue: null,
    sat: null,
  };

  protected reducedRange = 100;
  protected tempBright = 0;


  protected getPowerMode(): number {
    return POWERMODE_NORMAL;
  }

  async reduceBrightnessRange(limit: number) {
    if(this.reducedRange === limit) {
      return;
    }
    const brighter = (limit > this.reducedRange);

    this.tempBright = Math.ceil(this.properties.bright as number/this.reducedRange*limit);
    this.reducedRange = limit;

    if(!this.getPower()) {
      return;
    }

    if(brighter) {
      await sleep(100);
    }

    await this.setPower(true);
  }

  async setPower(value: boolean): Promise<void> {
    await super.setPower(value);
    await sleep(100);
    if(value && this.tempBright) {
      await this.setBrightness(this.tempBright/this.reducedRange*100);
    }
  }

  async setBrightness(value: number) {
    const brt = Math.ceil(value/100*this.reducedRange);
    this.properties.bright = brt;
    if(!this.getPower()) {
      this.tempBright = brt;
      return;
    }
    this.tempBright = 0;
    await this.call('set_bright', [brt, (TRANSITION_DURATION ? 'smooth' : 'sudden'), TRANSITION_DURATION]);
  }

  async setColorTemperature(value: number) {
    await super.setColorTemperature(value);

    const { h, s } = convertHomeKitColorTemperatureToHomeKitColor(value);
    this.properties.hue = h;
    this.properties.sat = s;
  }

  getBrightness() {
    return (this.tempBright ? this.tempBright : this.properties.bright as number)/this.reducedRange*100;
  }

  async setHue(value: number) {
    if(!this.getPower()) {
      return;
    }
    this.properties.hue = value;
    await this.call('set_hsv',
      [value, parseInt(this.properties.sat as string), (TRANSITION_DURATION ? 'smooth' : 'sudden'), TRANSITION_DURATION]);
  }

  getHue() {
    return this.properties.hue;
  }

  async setSaturation(value: number) {
    if(!this.getPower()) {
      return;
    }
    this.properties.sat = value;
    await this.call('set_hsv',
      [parseInt(this.properties.hue as string), value, (TRANSITION_DURATION ? 'smooth' : 'sudden'), TRANSITION_DURATION]);
  }

  getSaturation() {
    return this.properties.sat;
  }
}