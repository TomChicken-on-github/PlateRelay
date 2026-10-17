export type PrinterState = 
  | 'IDLE' 
  | 'PREPARING' 
  | 'PRINTING' 
  | 'PAUSED' 
  | 'CLEARING_REQUIRED' 
  | 'OFFLINE' 
  | 'UNMANAGED_PRINTING';

export interface Temperatures {
  nozzle: number;
  nozzle_target: number;
  bed: number;
  bed_target: number;
  chamber?: number;
}

export interface AmsTray {
  id: number;
  tray_id_name?: string;
  tray_sub_brands?: string;
  tray_color: string; // e.g. "FFFFFF", "000000", "00AE42"
  tray_type: string;  // e.g. "PLA", "PETG", "ABS"
  remain_percent?: number;
  is_active?: boolean;
}

export interface Printer {
  id: string;
  name: string;
  model: string; // e.g. "Bambu X1-Carbon", "Bambu P1S", "Bambu A1-Mini", "Bambu X2D"
  serial_number: string;
  ip_address?: string;
  state: PrinterState;
  temperatures: Temperatures;
  progress: number; // 0.0 - 100.0
  remaining_time_min: number;
  current_layer: number;
  total_layers: number;
  ams_trays: AmsTray[];
  status_message?: string;
  task_name?: string;
  wifi_signal?: number;
  updated_at?: number;
}

export interface FleetSnapshotMessage {
  type: 'FLEET_SNAPSHOT';
  timestamp: number;
  printers: Printer[];
}

export interface FleetUpdateMessage {
  type: 'FLEET_UPDATE';
  timestamp: number;
  printers: Printer[];
}
