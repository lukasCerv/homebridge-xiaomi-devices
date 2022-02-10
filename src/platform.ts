import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { Observable, Subscriber } from 'rxjs';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { AirPurifier, CtMoonLight, ColorLight, MoonSwitch, RobotVacuum } from './platformAccessory';

export class XiaomiYeelightTestPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  public readonly accessories: PlatformAccessory[] = [];

  private nightMode = false;
  isNightMode() {
    return this.nightMode;
  }
  setNightMode(mode: boolean):void {
    this.nightMode = mode;
    for(let l of this.nightModeSubscribers) l.next(mode);
  }

  private nightModeSubscribers: Subscriber<boolean>[] = [];
  public nightSwitch = new Observable<boolean>((device: Subscriber<boolean>) => {
    device.next(this.nightMode);
    this.nightModeSubscribers.push(device);
  });

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.addMoonSwitch();
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  discoverDevices = async () => {
    const addedDevices = this.config?.devices || [];
    this.log.info(`Adding ${addedDevices.length} lights`);

    for (const device of addedDevices){
      this.getAccessory(device, "", (existing: PlatformAccessory) => {
        this.log.info('Restoring from cache:', device.name);
        existing.context.device = device;
        this.addAccessory(device, existing, (acc: PlatformAccessory) => this.updatePlatformAccessory(acc));
      }, (created: PlatformAccessory) => {
        this.log.info('Adding new accessory:', device.name);
        created.context.device = device;
        this.addAccessory(device, created, (acc: PlatformAccessory) => this.registerPlatformAccessory(acc));
      });
    }
  };

  private getAccessory(device: any, uuid_postfix: string, cached: Function, created: Function) {
    const uuid = this.api.hap.uuid.generate(device.ipAddress + uuid_postfix);
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if(existingAccessory) return cached(existingAccessory);
    else return created(new this.api.platformAccessory(device.name, uuid));
  }

  private addAccessory(device: any, accessory: PlatformAccessory, callback: Function){
    /*let subAccessory = (uuid_suffix: string) => {
      let acc: any = null;
      this.getAccessory(device, uuid_suffix, (cached: PlatformAccessory) => {
        acc = cached;
        this.updatePlatformAccessory(cached);
      }, (created: PlatformAccessory) => {
        acc = created;
        this.registerPlatformAccessory(created);
      });
      return acc;
    }*/
    
    switch(device.type){
      case "ct_moon_light": new CtMoonLight(this, accessory); break;
      case "color_light": new ColorLight(this, accessory); break;
      case "air_purifier": new AirPurifier(this, accessory); break;
      case "vacuum_cleaner": new RobotVacuum(this, accessory); break;
    }
    callback(accessory);
  }

  private updatePlatformAccessory(accessory: PlatformAccessory){
    this.api.updatePlatformAccessories([accessory]);
  }

  private registerPlatformAccessory(accessory: PlatformAccessory){
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }

  private addMoonSwitch() {
    this.log.info("Adding Moon Switch");
    const uuid = this.api.hap.uuid.generate("yeelight-moon-switch");
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
    if (existingAccessory) {
      // the accessory already exists
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      this.api.updatePlatformAccessories([existingAccessory]);

      new MoonSwitch(this, existingAccessory);
    } else {
      this.log.info('Adding new moon switch.');

      // create a new accessory
      const accessory = new this.api.platformAccessory("Moon Switch", uuid);

      new MoonSwitch(this, accessory);

      // link the accessory to your platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }
}
