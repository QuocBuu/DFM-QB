// ESP32-C3 layout contract. Allocation sizes, not measured image usage.
// Source: firmware partitions.csv + scripts/full_update.py FILES.
export const FLASH_SIZE = 0x400000;
export const flashRegions = [
  {id:'bootloader', name:'Bootloader', partition:'bootloader', offset:0x000000, size:0x8000, kind:'System', color:'#64748b', write:true, description:'Starts the chip and selects a bootable application.'},
  {id:'partitions', name:'Partition table', partition:'partitions', offset:0x008000, size:0x1000, kind:'System', color:'#94a3b8', write:true, description:'Defines the fixed addresses of all flash partitions.'},
  {id:'nvs', name:'NVS', partition:'nvs', offset:0x009000, size:0x5000, kind:'Data', color:'#c08b32', backup:true, description:'Saved parameters, IMU calibration and Wi-Fi credentials. Preserved during updates.'},
  {id:'otadata', name:'OTA metadata', partition:'otadata', offset:0x00e000, size:0x2000, kind:'Data', color:'#a87244', backup:true, description:'Boot selection metadata. Full updates select Recovery; old metadata is not restored.'},
  {id:'recovery', name:'Recovery', partition:'factory', offset:0x010000, size:0x0f0000, kind:'Application', color:'#479483', write:true, description:'Recovery application for maintenance and starting Flight.'},
  {id:'flight', name:'Flight', partition:'ota_0', offset:0x100000, size:0x300000, kind:'Application', color:'#245fbd', write:true, description:'Main application: IMU streaming, parameters and diagnostics.'}
];
export const hexOffset = value => '0x' + value.toString(16).toUpperCase().padStart(6, '0');
export const regionSize = value => value >= 1024 * 1024 ? `${value / (1024 * 1024)} MiB` : `${value / 1024} KiB`;
