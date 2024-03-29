import {getEnv} from "../utility";

export const PATH = String(getEnv('MODEM_PATH', '/dev/ttyACM0')) as string;
export const BAUD_RATE = parseInt(getEnv('MODEM_BAUD_RATE', 9600), 10) as number;
