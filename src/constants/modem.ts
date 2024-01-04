import {getEnv} from "../utility";

export const PATH = String(getEnv('MODEM_PATH', '/dev/modem')) as string;
export const BAUD_RATE = parseInt(getEnv('MODEM_BAUD_RATE', 115200), 10) as number;

export const COMMANDS_SEQUENCE = String(getEnv('MODEM_COMMANDS_SEQUENCE', 'Z;+FCLASS=8;L1;A;H;L3;m1x3DT{{PHONE_NUMBER}}'));
