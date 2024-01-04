import {getEnv} from "../utility";

export const TOKEN = String(getEnv('BOT_TOKEN', '')); // TODO: Remove default
export const ALLOWED_USER_IDS = (
	String(getEnv('BOT_ALLOWED_USER_IDS', ''))
		.split(',')
		.map((userId) => userId.trim())
		.filter((userId) => /[0-9]+/.test(userId))
		.map(userId => Number(userId))
);
