import {getEnv} from "../utility";

export const TOKEN = String(getEnv('BOT_TOKEN', '')); // TODO: Remove default

const ADMIN_USER_ID_RAW = String(getEnv('BOT_ADMIN_USER_ID', '')).trim();
export const ADMIN_USER_ID = (
	(/[0-9]+/).test(ADMIN_USER_ID_RAW)
		? Number(ADMIN_USER_ID_RAW)
		: undefined
);
