import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { XiaomiYeelightTestPlatform } from './platform';
import { AirPurifierDevice, YeelightDevice, ColorDevice, CtMoonDevice, VacuumDevice } from './device';

const REDUCED_BRT_RANGE = 15;
const REFRESH_INTERVAL = 30; // seconds
const OLD_CHARS_ACCEPTED = 0; // miliseconds

abstract class Device {
  private updateCharsTimeout: any;
  private lastUpdatedChars = 0;

  constructor(
    protected readonly platform: XiaomiYeelightTestPlatform,
    protected readonly accessory: PlatformAccessory,
    model = 'Device',
    manufacturer = 'Xiaomi',
  ) {
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, manufacturer)
      .setCharacteristic(this.platform.Characteristic.Model, model);
  }

  protected isDebugLogging(): boolean {
    return this.platform.config.debugLogging;
  }

  protected async updateChars(refreshDevice: () => Promise<any>) {
    clearTimeout(this.updateCharsTimeout);
    this.updateCharsTimeout = setTimeout(() => this.updateChars(refreshDevice), REFRESH_INTERVAL * 1000);
    if(Date.now() - this.lastUpdatedChars > OLD_CHARS_ACCEPTED) {
      await refreshDevice();
    }
    this.lastUpdatedChars = Date.now();
  }

  protected async runLoggedAction(action: () => Promise<any>, log = 'action') {
    if (this.isDebugLogging()) {
      this.platform.log.info('performing: \'' + log + '\' on \'' + this.accessory.context.device.name + '\'');
    }
    try {
      await action();
      if (this.isDebugLogging()) {
        this.platform.log.info('done \'' + log + '\' on \'' + this.accessory.context.device.name + '\'');
      }
    } catch (e: any) {
      this.platform.log.error(e);
    }
  }
}

abstract class Light extends Device {
  protected service: Service;
  protected device: YeelightDevice = this.generateDevice();

  constructor(
    protected readonly platform: XiaomiYeelightTestPlatform,
    protected readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory, 'Yeelight Light');

    this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);

    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.get().on.bind(this))
      .onSet(async (value) => {
        await this.runLoggedAction(async () => {
          await this.device.setPower(value as boolean);
          await this.updateChars();
        }, 'set power to ' + value);
      });

    this.service.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.get().brightness.bind(this))
      .onSet(async (value) => {
        await this.runLoggedAction(async () => {
          await this.device.setBrightness(value as number);
          await this.updateChars();
        }, 'set brightness to ' + value);
      });

    this.service.getCharacteristic(this.platform.Characteristic.ColorTemperature)
      .onGet(this.get().colorTemperature.bind(this))
      .onSet(this.setColorTemperature.bind(this));

    this.updateChars();
  }

  protected generateDevice() {
    return new YeelightDevice((arg: string) => {
      if(this.isDebugLogging()) {
        this.platform.log.info(arg);
      }
    });
  }

  protected convertColorTemp(value: number): number {
    return Math.round(1000000 / value);
  }

  protected get():any {
    return {
      on: () => {
        return this.device.getPower();
      },
      brightness: () => {
        return this.device.getBrightness();
      },
      colorTemperature: () => {
        return this.convertColorTemp(this.device.getColorTemperature());
      },
    };
  }

  protected async setColorTemperature(value: CharacteristicValue) {
    await this.runLoggedAction(async () => {
      await this.device.setColorTemperature(this.convertColorTemp(value as number));
      await this.updateChars();
    }, 'set color temperature to ' + value);
  }

  protected async updateChars() {
    await super.updateChars(async () => await this.device.getProperties());

    this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.get().on());
    this.service.getCharacteristic(this.platform.Characteristic.Brightness).updateValue(this.get().brightness());
    this.service.getCharacteristic(this.platform.Characteristic.ColorTemperature).updateValue(this.get().colorTemperature());
  }
}

export class CtMoonLight extends Light {
  protected device: CtMoonDevice = this.generateDevice();

  constructor(
    platform: XiaomiYeelightTestPlatform,
    accessory: PlatformAccessory,
  ) {
    super(platform, accessory);

    try {
      this.device.connect(accessory.context.device.ipAddress, accessory.context.device.token);
    } catch(e:any) {
      this.platform.log.error(e);
    }

    this.service.getCharacteristic(this.platform.Characteristic.ColorTemperature)
      .setProps({
        minValue: 168,
        maxValue: 370,
        minStep: 1,
      });

    this.platform.nightSwitch.subscribe((nightMode: boolean) => {
      this.runLoggedAction(async () => {
        await this.device.setMoonMode(nightMode);
        await this.updateChars();
      }, 'set night mode to ' + nightMode);
    });
  }

  protected generateDevice() {
    return new CtMoonDevice((arg: string) => {
      if(this.isDebugLogging()) {
        this.platform.log.info(arg);
      }
    });
  }
}

export class ColorLight extends Light {
  protected device: ColorDevice = this.generateDevice();

  constructor(
    platform: XiaomiYeelightTestPlatform,
    accessory: PlatformAccessory,
  ) {
    super(platform, accessory);

    try {
      this.device.connect(accessory.context.device.ipAddress, accessory.context.device.token);
    } catch(e:any) {
      this.platform.log.error(e);
    }

    this.service.getCharacteristic(this.platform.Characteristic.ColorTemperature)
      .setProps({
        minValue: 154,
        maxValue: 588,
        minStep: 1,
      });

    this.service.getCharacteristic(this.platform.Characteristic.Hue)
      .onGet(this.get().hue.bind(this))
      .onSet(async (value) => {
        await this.runLoggedAction(async () => {
          await this.device.setHue(value as number);
          await this.updateChars();
        }, 'set hue to ' + value);
      });


    this.service.getCharacteristic(this.platform.Characteristic.Saturation)
      .onGet(this.get().saturation.bind(this))
      .onSet(async (value) => {
        await this.runLoggedAction(async () => {
          await this.device.setSaturation(value as number);
          await this.updateChars();
        }, 'set saturation to ' + value);
      });

    this.platform.nightSwitch.subscribe((nightMode: boolean) => {
      this.runLoggedAction(async () => {
        await this.device.reduceBrightnessRange(nightMode ? REDUCED_BRT_RANGE : 100);
        await this.updateChars();
      }, 'set night mode to ' + nightMode);
    });
  }

  protected generateDevice() {
    return new ColorDevice((arg: string) => {
      if(this.isDebugLogging()) {
        this.platform.log.info(arg);
      }
    });
  }

  protected get() {
    const get = super.get();
    get.hue = () => {
      return this.device.getHue();
    };
    get.saturation = () => {
      return this.device.getSaturation();
    };
    return get;
  }

  protected async updateChars() {
    super.updateChars();
    this.updateHS();
  }

  private updateHS() {
    this.service.getCharacteristic(this.platform.Characteristic.Hue).updateValue(this.get().hue());
    this.service.getCharacteristic(this.platform.Characteristic.Saturation).updateValue(this.get().saturation());
  }

  async setColorTemperature(value: CharacteristicValue) {
    await super.setColorTemperature(value);
    this.updateHS();
  }
}

export class AirPurifier extends Device {
  protected purifierService: Service;
  protected temperatureService: Service;
  protected humidityService: Service;
  protected aqiService: Service;
  protected filterService: Service;
  protected device = new AirPurifierDevice((arg: string) => {
    if(this.isDebugLogging()) {
      this.platform.log.info(arg);
    }
  });

  constructor(
    protected readonly platform: XiaomiYeelightTestPlatform,
    protected readonly accessory: PlatformAccessory,
  ) {
    super(platform, accessory, 'Air Purifier');

    try {
      this.device.connect(accessory.context.device.ipAddress, accessory.context.device.token);
    } catch(e:any) {
      this.platform.log.error(e);
    }

    this.purifierService = this.accessory.getService(this.platform.Service.AirPurifier) || this.accessory.addService(this.platform.Service.AirPurifier);
    this.setupPurifier();

    this.temperatureService = this.accessory.getService(this.platform.Service.TemperatureSensor) || this.accessory.addService(this.platform.Service.TemperatureSensor);
    this.setupTemperature();

    this.humidityService = this.accessory.getService(this.platform.Service.HumiditySensor) || this.accessory.addService(this.platform.Service.HumiditySensor);
    this.setupHumidity();

    this.aqiService = this.accessory.getService(this.platform.Service.AirQualitySensor) || this.accessory.addService(this.platform.Service.AirQualitySensor);
    this.setupAQI();

    this.filterService = this.accessory.getService(this.platform.Service.FilterMaintenance) || this.accessory.addService(this.platform.Service.FilterMaintenance);
    this.setupFilter();

    this.updateChars();
  }

  private get = {
    active: () => {
      return (this.device.getMode() == AirPurifierDevice.MODE_IDLE ? this.platform.Characteristic.Active.INACTIVE : this.platform.Characteristic.Active.ACTIVE);
    },
    currentState: () => {
      return (this.device.getMode() == AirPurifierDevice.MODE_IDLE ? this.platform.Characteristic.CurrentAirPurifierState.INACTIVE : this.platform.Characteristic.CurrentAirPurifierState.PURIFYING_AIR);
    },
    targetState: () => {
      return (this.device.getMode() == AirPurifierDevice.MODE_FAVORITE ? this.platform.Characteristic.TargetAirPurifierState.MANUAL : this.platform.Characteristic.TargetAirPurifierState.AUTO);
    },
    favoriteLevel: () => {
      return this.device.getFavoriteLevel();
    },
    temperature: () => {
      return this.device.getTemperature();
    },
    humidity: () => {
      return this.device.getHumidity();
    },
    aqi: () => {
      return Math.ceil(this.device.getAQI()/15);
    },
    filterChange: () => {
      return this.device.getFilterLife() < 10;
    },
    filterLifeLevel: () => {
      const life = this.device.getFilterLife();
      return life > 100 ? 100 : life;
    },
  };

  protected async updateChars() {
    await super.updateChars(async () => await this.device.getProperties());

    this.purifierService.getCharacteristic(this.platform.Characteristic.Active).updateValue(this.get.active());
    this.purifierService.getCharacteristic(this.platform.Characteristic.CurrentAirPurifierState).updateValue(this.get.currentState());
    this.purifierService.getCharacteristic(this.platform.Characteristic.TargetAirPurifierState).updateValue(this.get.targetState());
    this.purifierService.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(this.get.favoriteLevel());

    this.temperatureService.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(this.get.temperature());
    this.humidityService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity).updateValue(this.get.humidity());
    this.aqiService.getCharacteristic(this.platform.Characteristic.AirQuality).updateValue(this.get.aqi());

    this.filterService.getCharacteristic(this.platform.Characteristic.FilterChangeIndication).updateValue(this.get.filterChange());
    this.filterService.getCharacteristic(this.platform.Characteristic.FilterLifeLevel).updateValue(this.get.filterLifeLevel());
  }

  private setupPurifier() {
    this.purifierService.setCharacteristic(this.platform.Characteristic.Name, this.accessory.context.device.name);

    this.purifierService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.get.active.bind(this))
      .onSet(async (value) => {
        await this.runLoggedAction(async () => {
          if(!value) {
            await this.device.setMode(AirPurifierDevice.MODE_IDLE);
            await this.updateChars();
          }
        }, 'set active to ' + value);
      });

    this.purifierService.getCharacteristic(this.platform.Characteristic.CurrentAirPurifierState)
      .onGet(this.get.currentState.bind(this));

    this.purifierService.getCharacteristic(this.platform.Characteristic.TargetAirPurifierState)
      .onGet(this.get.targetState.bind(this))
      .onSet(async (state) => {
        await this.runLoggedAction(async () => {
          await this.device.setMode(state == this.platform.Characteristic.TargetAirPurifierState.MANUAL ? AirPurifierDevice.MODE_FAVORITE : (this.device.isNightMode() ? AirPurifierDevice.MODE_SILENT : AirPurifierDevice.MODE_AUTO));
          await this.updateChars();
        }, 'set target state to ' + state);
      });

    this.purifierService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(this.get.favoriteLevel.bind(this))
      .onSet(async (level) => {
        await this.runLoggedAction(async () => {
          await this.device.setFavoriteLevel(level as number);
          await this.updateChars();
        }, 'set manual speed to ' + level);
      });

    this.platform.nightSwitch.subscribe((nightMode: boolean) => {
      this.runLoggedAction(async () => {
        await this.device.setNightMode(nightMode);
        await this.updateChars();
      }, 'set night mode to ' + nightMode);
    });
  }

  private setupTemperature() {
    this.temperatureService.setCharacteristic(this.platform.Characteristic.Name, this.accessory.context.device.name + ' Temperature');

    this.temperatureService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.get.temperature.bind(this));
  }

  private setupHumidity() {
    this.humidityService.setCharacteristic(this.platform.Characteristic.Name, this.accessory.context.device.name + ' Humidity');

    this.humidityService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.get.humidity.bind(this));
  }

  private setupAQI() {
    this.aqiService.setCharacteristic(this.platform.Characteristic.Name, this.accessory.context.device.name + ' AQI');

    this.aqiService.getCharacteristic(this.platform.Characteristic.AirQuality)
      .onGet(this.get.aqi.bind(this));
  }

  private setupFilter() {
    this.filterService.setCharacteristic(this.platform.Characteristic.Name, this.accessory.context.device.name + ' Filter');

    this.filterService.getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(this.get.filterChange.bind(this));

    this.filterService.getCharacteristic(this.platform.Characteristic.FilterLifeLevel)
      .onGet(this.get.filterLifeLevel.bind(this));
  }
}

export class RobotVacuum extends Device {
  private vacuumService: Service;
  private batteryService: Service;
  private fanService: Service;
  private waterService: Service;
  protected device = new VacuumDevice((arg: string) => {
    if(this.isDebugLogging()) {
      this.platform.log.info(arg);
    }
  });

  constructor(
    protected readonly platform: XiaomiYeelightTestPlatform,
    protected readonly vacuum: PlatformAccessory,
  ) {
    super(platform, vacuum, 'Robot Vacuum Cleaner');

    try {
      this.device.connect(vacuum.context.device.ipAddress, vacuum.context.device.token);
    } catch(e:any) {
      this.platform.log.error(e);
    }

    this.vacuumService = this.vacuum.getService(this.platform.Service.Switch) || this.vacuum.addService(this.platform.Service.Switch);
    this.setupVacuum();

    this.batteryService = this.vacuum.getService(this.platform.Service.Battery) || this.vacuum.addService(this.platform.Service.Battery);
    this.setupBattery();

    this.fanService = this.vacuum.getService('fan_speed') || this.vacuum.addService(this.platform.Service.Fan, 'fan_speed', 'FAN_fan_speed');
    this.setupFan();

    this.waterService = this.vacuum.getService('water_flow') || this.vacuum.addService(this.platform.Service.Fan, 'water_flow', 'FAN_water_flow');
    this.setupWater();

    this.updateChars();
  }



  private get = {
    state: () => {
      return this.device.getState() == VacuumDevice.STATE.CLEANING;
    },
    lowBattery: () => {
      return (this.device.isBatteryLow() || this.device.getBattery() < 20);
    },
    battery: () => {
      return this.device.getBattery();
    },
    charging: () => {
      return this.device.getState() == VacuumDevice.STATE.CHARGING ? this.platform.Characteristic.ChargingState.CHARGING : this.platform.Characteristic.ChargingState.NOT_CHARGING;
    },
    fanSpeed: () => {
      return this.device.getFanSpeed();
    },
    waterLevel: () => {
      return this.device.getWaterLevel();
    },
  };

  protected async updateChars() {
    await super.updateChars(async () => await this.device.getProperties());

    this.vacuumService.getCharacteristic(this.platform.Characteristic.On).updateValue(this.get.state());

    this.batteryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery).updateValue(this.get.lowBattery());
    this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel).updateValue(this.get.battery());
    this.batteryService.getCharacteristic(this.platform.Characteristic.ChargingState).updateValue(this.get.charging());

    this.fanService.getCharacteristic(this.platform.Characteristic.On).updateValue(true);
    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(this.get.fanSpeed());

    this.waterService.getCharacteristic(this.platform.Characteristic.On).updateValue(true);
    this.waterService.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(this.get.waterLevel());
  }

  private setupVacuum() {
    this.vacuumService.setCharacteristic(this.platform.Characteristic.Name, this.vacuum.context.device.name);

    this.vacuumService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value) => {
        await this.runLoggedAction(async () => {
          await this.device.setCleaning(value as boolean);
          await this.updateChars();
        }, 'set power to ' + value);
      })
      .onGet(this.get.state.bind(this));
  }

  private setupBattery() {
    this.batteryService.setCharacteristic(this.platform.Characteristic.Name, this.vacuum.context.device.name + ' Battery');

    this.batteryService.getCharacteristic(this.platform.Characteristic.StatusLowBattery)
      .onGet(this.get.lowBattery.bind(this));

    this.batteryService.getCharacteristic(this.platform.Characteristic.BatteryLevel)
      .onGet(this.get.battery.bind(this));

    this.batteryService.getCharacteristic(this.platform.Characteristic.ChargingState)
      .onGet(this.get.charging.bind(this));
  }

  private setupFan() {
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, this.vacuum.context.device.name + ' Fan');

    this.fanService.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => {
        return true;
      })
      .onSet(async () => {
        await this.updateChars();
      });

    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 25,
        maxValue: 100,
        minStep: 25,
      })
      .onGet(this.get.fanSpeed.bind(this))
      .onSet(async (value) => {
        await this.runLoggedAction(async () => {
          await this.device.setFanSpeed(value as number);
          await this.updateChars();
        }, 'set fan speed to ' + value);
      });
  }

  private setupWater() {
    this.waterService.setCharacteristic(this.platform.Characteristic.Name, this.vacuum.context.device.name + ' Water Flow');

    this.waterService.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => {
        return true;
      })
      .onSet(async () => {
        await this.updateChars();
      });

    this.waterService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 50,
        maxValue: 100,
        minStep: 25,
      })
      .onGet(this.get.waterLevel.bind(this))
      .onSet(async (value) => {
        await this.runLoggedAction(async () => {
          await this.device.setWaterLevel(value as number);
          await this.updateChars();
        }, 'set water level to ' + value);
      });
  }
}

export class MoonSwitch {
  private service: Service;
  private nightMode = this.platform.isNightMode();

  constructor(
    private readonly platform: XiaomiYeelightTestPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Homebridge')
      .setCharacteristic(this.platform.Characteristic.Model, 'Night Mode Switch');

    this.service = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);

    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Night Mode Switch');

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));
  }

  isDebugLogging(): boolean {
    return this.platform.config.debugLogging;
  }

  setOn(value: CharacteristicValue) {
    if(value as boolean == this.nightMode) {
      return;
    }

    if (this.isDebugLogging()) {
      this.platform.log.info('setting night mode switch to', value);
    }
    try {
      this.nightMode = value as boolean;
      this.platform.setNightMode(value as boolean);

      if (this.isDebugLogging()) {
        this.platform.log.info('night mode switch set successfully');
      }
    } catch (e: any) {
      this.platform.log.error(e);
    }
  }

  getOn(): boolean {
    return this.nightMode;
  }
}