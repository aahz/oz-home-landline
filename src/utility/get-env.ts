import _get from 'lodash/get';

export function getEnv(name: string | (string | number)[], defaultValue?: any): any {
	return _get(process.env, name, defaultValue);
}
