import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service,
} from 'homebridge';

import storage from 'node-persist';

import { PLUGIN_NAME, PLATFORM_NAME } from './settings';

let hap: HAP;

module.exports = (api) => {
  hap = api.hap;
  api.registerAccessory(PLUGIN_NAME, PLATFORM_NAME, ExampleWindowCoveringAccessory);
};

class ExampleWindowCoveringAccessory implements AccessoryPlugin {

  private readonly log: Logging;
  private readonly config: AccessoryConfig;
  private readonly api: API;
  private readonly windowService: Service;
  private readonly uuid: string;
  private readonly name: string;
  private target: number;
  private Characteristic: any;
  private readonly upSwitchService: Service;
  private readonly downSwitchService: Service;
  // private readonly controlButtonUp: Service;
  private readonly full_window_length: number;
  private motion_state: number;
  private current_position: number;
  private cacheDirectory: string;
  private storage;
  private downSwitchState;
  private upSwitchState;
  private cachedState;
  private motion_start : number;
  // private control_button_state: boolean;
  private readonly informationService: Service;
  private timer;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    
    this.log = log;
    this.config = config;
    this.api = api;
    this.name = config.name;
    this.cacheDirectory = api.user.persistPath();
    this.motion_state = 2;
    this.motion_start = -1;
    // get the persistent storage
    this.storage = require('node-persist');
    this.storage.initSync({dir:this.cacheDirectory, forgiveParseErrors: true});
    this.target = 0;
    const UUIDGen = api.hap.uuid;
    this.windowService = new hap.Service.WindowCovering(this.name, 'WindowCovering');
    this.upSwitchService = new hap.Service.Switch(this.name + 'up', 'upSwitch');
    this.downSwitchService = new hap.Service.Switch(this.name + 'down', 'downSwitch');
    
    this.uuid = UUIDGen.generate(this.name);
    this.current_position = 0;//this.storage;
    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, 'Michael')
      .setCharacteristic(hap.Characteristic.Model, 'WindowCovering');


    const cachedState = this.storage.getItemSync(this.name);

    // if((cachedState === undefined)) {
    //   this.current_state_seconds = cachedState;
    // } else {
    //   this.current_state_seconds = 0;
    // }

    this.Characteristic = this.api.hap.Characteristic;

    // extract name from config
    this.name = config.name;
    this.full_window_length = config.full_window_length;
    // create handlers for required characteristics
    this.windowService.getCharacteristic(hap.Characteristic.CurrentPosition)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        log.info('Get current position');
        const position = this.get_current_position();
        log.info('calculated position: ' + position);
        callback(undefined, position);
      });

    this.windowService.getCharacteristic(hap.Characteristic.PositionState)
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        log.info('Get position state');
        callback(undefined, this.motion_state);
      });

    this.windowService.getCharacteristic(hap.Characteristic.TargetPosition)
      // .onGet(this.handleCurrentPositionGet.bind(this));
      .on(CharacteristicEventTypes.GET, (callback: CharacteristicGetCallback) => {
        log.info('Get position state');
        callback(undefined, this.target);
      })
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        this.target = value as number;
        if(this.target > this.get_current_position()) {
          log.info('Window is opening');
          this.updateButton(1);
        } else if(this.target < this.get_current_position()){
          log.info('Window is closing');
          this.updateButton(-1);
        } else{
          log.info('Window is not going to change');
        }
        callback();
      });

    this.downSwitchService.getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        log.info('Down button was pressed: '+ value);
        const now = new Date();
        if(value !== this.downSwitchState){
          if(value){
            this.motion_start = Math.round(now.getTime() / 1000);
            this.motion_state = 0;  
          } else{
            this.reach_to_requiered_position_rutine();
            this.motion_state = 2;
          }
        }
        this.downSwitchState = value;
        callback();
      });

    this.upSwitchService.getCharacteristic(hap.Characteristic.On)
      .on(CharacteristicEventTypes.SET, (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
        log.info('Up button was pressed: '+ value);
        const now = new Date();
        if(value !== this.upSwitchState){
          if(value){
            this.motion_start = Math.round(now.getTime() / 1000);
            this.motion_state = 1;
          } else {
            this.reach_to_requiered_position_rutine();
            this.motion_state = 2;
          }
          this.upSwitchState = value;
        }
        callback();
      });
  }

  updateButton(direction:number): void {
    clearTimeout(this.timer);
    const bool:boolean = direction>0;
    this.log.info('direction is: '+ direction + ' and is:' + bool);
    const desired_target = this.target;
    if(direction>0){
      this.downSwitchService.getCharacteristic(hap.Characteristic.On).setValue(false);
      this.target=desired_target;
      this.upSwitchService.getCharacteristic(hap.Characteristic.On).setValue(true);
      this.timer = setTimeout(() => {
        this.upSwitchService.getCharacteristic(hap.Characteristic.On).setValue(false);
        this.windowService.getCharacteristic(hap.Characteristic.TargetPosition).setValue(this.current_position);
        this.windowService.getCharacteristic(hap.Characteristic.PositionState).setValue(2);
        // this.reach_to_requiered_position_rutine();
      }, this.calculate_requiered_run_rime());
      
    } else{
      this.upSwitchService.getCharacteristic(hap.Characteristic.On).setValue(false);
      this.target=desired_target;
      this.downSwitchService.getCharacteristic(hap.Characteristic.On).setValue(true);
      this.timer = setTimeout(() => {
        this.downSwitchService.getCharacteristic(hap.Characteristic.On).setValue(false);
        this.windowService.getCharacteristic(hap.Characteristic.TargetPosition).setValue(this.current_position);
        this.windowService.getCharacteristic(hap.Characteristic.PositionState).setValue(2);
        // this.reach_to_requiered_position_rutine();
      }, this.calculate_requiered_run_rime());
      
    }
  }


  reach_to_requiered_position_rutine(): void{
    this.current_position = this.get_current_position();
    this.motion_state = 2;
    this.target = this.current_position;
    this.motion_start = -1;
    this.log.info('finished operation');
  }

  calculate_requiered_run_rime(){
    const run_time = (Math.abs(this.get_current_position() - this.target)/100)*this.full_window_length*1000;
    this.log.info('run_time: '+run_time);
    return run_time;
  }


  get_current_position():number{
    let position:number;
    const now = new Date();
    if (this.motion_start>0){
      const direction = this.motion_state == 0? -1: 1;
      this.log.info('Calculating during motion');
      const diff = (Math.round(now.getTime() / 1000) - this.motion_start);
      const current_in_seconds = (this.current_position/100)*this.full_window_length + direction*diff;
      position = current_in_seconds<0?0:
        current_in_seconds>this.full_window_length? 100:
          (current_in_seconds/this.full_window_length)*100;
    } else{
      position = this.current_position;
    }
    this.log.info('Calculated position is:' + position);
    return position;
  }

  getServices(): Service[] {
    return [
      this.informationService,
      this.windowService,
      this.downSwitchService,
      this.upSwitchService,
      // this.controlButtonUp,
    ];
  }
}