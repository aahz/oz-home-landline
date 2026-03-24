import axios, {AxiosError, AxiosInstance} from 'axios';
import {SerialPort, ReadlineParser} from 'serialport';

export interface IModemParameters {
	path: string;
	baudRate: number;
	delimiterRead: string;
	delimiterWrite: string;
	timeout: number;
	delay: number;
	isLogEnabled: boolean;
	log: (chunk: string) => void;
	api: {
		basePath: string;
		token: string;
	};
	onFallbackPrimaryEnabled?: () => void;
	transportStateStore?: IModemTransportStateStore;
}

export interface IModemRequest {
	command: string;
	terminators?: (string | RegExp)[];
	timeout?: number;
	delay?: number;
	isValidTimeout?: boolean;
}

export interface IModemResponse {
	command: string;
	response: string[];
	reason: 'response' | 'timeout',
	timeStart: Date;
	timeEnd: Date;
}

export interface IModemTransportState {
	failureCount: number;
	windowStartAt?: Date;
	fallbackPrimarySince?: Date;
}

export interface IModemTransportStateStore {
	getModemSerialTransportState: (now?: Date) => IModemTransportState;
	recordModemSerialFailure: (now?: Date) => {state: IModemTransportState; isPromoted: boolean;};
	resetModemSerialFailures: () => void;
}

export default class Modem {
	public static PARAMETERS: IModemParameters = {
		path: '/dev/ttyACM0',
		baudRate: 9600,
		delimiterRead: '\r\n',
		delimiterWrite: '\r\n',
		timeout: 10000,
		delay: 100,
		isLogEnabled: true,
		log: (chunk: string): void => console.log(`MODEM ${Date.now()}: ${chunk}`),
		api: {
			basePath: '',
			token: '',
		},
		onFallbackPrimaryEnabled: undefined,
		transportStateStore: undefined,
	};

	private static readonly FALLBACK_ACQUIRE_TIMEOUT_MS = 60000;
	private static readonly FALLBACK_SEND_MAX_RETRIES = 3;

	protected readonly $port: SerialPort;

	protected readonly $parameters: IModemParameters;
	protected readonly $api: AxiosInstance | null;

	private _isProcessing: boolean = false;

	private readonly _outOfProcessingParser: ReadlineParser;

	public constructor (parameters: Partial<IModemParameters>) {
		this.$parameters = Object.assign({}, Modem.PARAMETERS, parameters);

		this.$port = new SerialPort({
			path: this.$parameters.path,
			baudRate: this.$parameters.baudRate,
			parity: 'none',
			dataBits: 8,
			stopBits: 1,
		});

		this._outOfProcessingParser = (
			(new ReadlineParser({
				delimiter: this.$parameters.delimiterRead,
				includeDelimiter: false,
			}))
				.on('data', this._handleOutOfProcessingChunk)
		);

		this.$port.pipe(this._outOfProcessingParser);
		this.$api = this._createApiClient();
	}

	private _handleOutOfProcessingChunk = (chunk: string): void => {
		this._log(['?<?', chunk].join(' '));
	}

	private _log(chunk: string): void {
		if (!this.$parameters.isLogEnabled) {
			return;
		}

		this.$parameters.log(chunk);
	}

	public async send(request: IModemRequest): Promise<IModemResponse> {
		if (this._isProcessing) {
			return Promise.reject(new Error('Modem is processing another request'));
		}

		this._isProcessing = true;

		try {
			const isFallbackPrimaryEnabled = this._isFallbackPrimaryEnabled();

			if (!isFallbackPrimaryEnabled) {
				try {
					const serialResponse = await this._sendViaSerial(request);
					this._resetSerialFailures();

					return serialResponse;
				} catch (error: any) {
					this._log(`Serial transport error: ${error.message || error.toString()}`);
					this._recordSerialFailureAndNotifyIfNeeded();
				}
			}

			return await this._sendViaApi(request);
		} finally {
			this._isProcessing = false;
		}
	}

	public close(): Promise<void> {
		if (!this.$port.isOpen) {
			return Promise.resolve();
		}

		return new Promise((resolve, reject) => {
			this.$port.close((error) => {
				(!error ? resolve() : reject(error));
			});
		});
	}

	private _createApiClient(): AxiosInstance | null {
		const baseURL = this._normalizeApiBaseUrl(this.$parameters.api?.basePath);
		const token = String(this.$parameters.api?.token || '').trim();

		if (!baseURL || !token) {
			if (!baseURL && String(this.$parameters.api?.basePath || '').trim().length > 0) {
				this._log(`Fallback API is disabled: invalid MODEM_FALLBACK_API_PATH "${String(this.$parameters.api?.basePath || '').trim()}"`);
			}

			return null;
		}

		return axios.create({
			baseURL,
			timeout: Modem.FALLBACK_ACQUIRE_TIMEOUT_MS + 1000,
			headers: {
				Authorization: `Bearer ${token}`,
				'Content-Type': 'application/json',
			},
		});
	}

	private _normalizeApiBaseUrl(rawBasePath?: string): string | null {
		const raw = String(rawBasePath || '').trim();

		if (!raw) {
			return null;
		}

		const withProtocol = (/^https?:\/\//i).test(raw)
			? raw
			: `https://${raw.replace(/^\/+/, '')}`;

		try {
			const parsed = new URL(withProtocol);

			return parsed.toString().replace(/\/+$/, '');
		} catch (_error: any) {
			return null;
		}
	}

	private _isFallbackPrimaryEnabled(): boolean {
		return !!this.$parameters.transportStateStore
			&& !!this.$parameters.transportStateStore.getModemSerialTransportState().fallbackPrimarySince;
	}

	private _recordSerialFailureAndNotifyIfNeeded(): void {
		if (!this.$parameters.transportStateStore) {
			return;
		}

		const result = this.$parameters.transportStateStore.recordModemSerialFailure();

		if (result.isPromoted) {
			this.$parameters.onFallbackPrimaryEnabled?.();
		}
	}

	private _resetSerialFailures(): void {
		if (!this.$parameters.transportStateStore) {
			return;
		}

		this.$parameters.transportStateStore.resetModemSerialFailures();
	}

	private async _sendViaApi(request: IModemRequest): Promise<IModemResponse> {
		if (!this.$api) {
			throw new Error('Fallback API is not configured');
		}

		const command = String(request.command || '').trim().toUpperCase();
		const timeout = Number.isFinite(request?.timeout) && request?.timeout as number >= 0
			? request?.timeout as number
			: this.$parameters.timeout;
		const timeStart = new Date();

		let isTimedOut = false;
		let responseText = '';
		let isAcquired = false;

		try {
			await this.$api.post('/acquire', {
				timeoutMs: Modem.FALLBACK_ACQUIRE_TIMEOUT_MS,
			});
			isAcquired = true;

			for (let retry = 0; retry <= Modem.FALLBACK_SEND_MAX_RETRIES; retry += 1) {
				try {
					const response = await this.$api.post('/at/send', {
						command,
						timeoutMs: timeout,
					}, {
						timeout: timeout + 1000,
					});

					responseText = String(response?.data?.response || '').trim();
					isTimedOut = false;
					break;
				} catch (error: any) {
					const isTimeout = this._isRequestTimeout(error);

					if (isTimeout && retry < Modem.FALLBACK_SEND_MAX_RETRIES) {
						continue;
					}

					if (isTimeout) {
						isTimedOut = true;
						break;
					}

					throw this._wrapApiError('Fallback /at/send failed', error);
				}
			}
		} catch (error: any) {
			if (!isAcquired) {
				throw this._wrapApiError('Fallback /acquire failed', error);
			}

			throw error;
		} finally {
			try {
				await this.$api.post('/release');
			} catch (releaseError: any) {
				this._log(`Fallback release failed: ${releaseError.message || releaseError.toString()}`);
			}
		}

		if (isTimedOut) {
			if (!request?.isValidTimeout) {
				throw new Error(`Timeout ${timeout} ms is reached for command "${command}" in fallback API`);
			}

			return {
				command,
				response: [],
				reason: 'timeout',
				timeStart,
				timeEnd: new Date(),
			};
		}

		return {
			command,
			response: this._splitApiResponse(responseText),
			reason: 'response',
			timeStart,
			timeEnd: new Date(),
		};
	}

	private _splitApiResponse(response: string): string[] {
		if (!response) {
			return [];
		}

		return response
			.split(/\r?\n/g)
			.map((chunk) => chunk.trim())
			.filter((chunk) => chunk.length > 0);
	}

	private _isRequestTimeout(error: any): boolean {
		return axios.isAxiosError(error)
			&& (error.code === 'ECONNABORTED' || String(error.message).toLowerCase().includes('timeout'));
	}

	private _wrapApiError(prefix: string, error: any): Error {
		if (axios.isAxiosError(error)) {
			const axiosError = error as AxiosError<{error?: string; details?: string}>;
			const data = axiosError.response?.data;
			const details = [data?.error, data?.details].filter(Boolean).join(' ');

			return new Error([
				prefix,
				`HTTP ${axiosError.response?.status || 'ERR'}`,
				details || axiosError.message || String(error),
			].join('. '));
		}

		return new Error(`${prefix}. ${error?.message || error?.toString?.() || String(error)}`);
	}

	private async _sendViaSerial(request: IModemRequest): Promise<IModemResponse> {
		const command = [request.command, this.$parameters.delimiterWrite].join('').toUpperCase();
		const terminators = (request?.terminators || ['OK']).map(terminator => terminator === String(terminator) ? terminator.toUpperCase() : terminator);
		const timeout = Number.isFinite(request?.timeout) && request?.timeout as number >= 0 ? request?.timeout : this.$parameters.timeout;
		const delay = Number.isFinite(request?.delay) ? request?.delay : this.$parameters.delay;
		const parser = new ReadlineParser({
			delimiter: this.$parameters.delimiterRead,
			includeDelimiter: false,
		});
		const timeStart = new Date();
		let timeoutId: NodeJS.Timeout | number | undefined;

		return (
			new Promise((resolve => setTimeout(resolve, delay)))
				.then(() => {
					this.$port.unpipe(this._outOfProcessingParser);
				})
				.then(() => new Promise<void>((resolve, reject) => {
					if (this.$port.isOpen) {
						return resolve();
					}

					this.$port.open((error) => {
						(!error ? resolve() : reject(error));
					})
				}))
				.then(() => new Promise<void>((resolve, reject) => {
					this.$port.flush((error) => {
						(!error ? resolve() : reject(new Error(['Flush operation failed.', error.message || error.toString()].join(' '))));
					});
				}))
				.then(() => Promise.race<IModemResponse>([
					(
						new Promise<string[]>((resolve, reject) => {
							const response: string[] = [];

							parser.on('data', (chunk) => {
								chunk = chunk.trim();

								this._log(['<<<', chunk].join(' '));

								response.push(chunk);

								if (terminators.some(terminator => typeof terminator === 'string' ? chunk === terminator.trim() : terminator.test(chunk))) {
									resolve(response);
								}
							});

							this.$port.pipe(parser);

							this.$port.write(command, (error) => {
								this._log(['>>>', command.trim()].join(' '));
								(!!error && reject(new Error(['Write operation failed.', error.message || error.toString()].join(' '))));
							});

							this.$port.drain((error) => {
								(!!error && reject(new Error(['Drain operation failed.', error.message || error.toString()].join(' '))));
							});
						})
							.then((response) => {
								return {
									command: command.trim(),
									response: response,
									reason: 'response',
									timeStart: timeStart,
									timeEnd: new Date(),
								} as IModemResponse;
							})
					),
					new Promise<IModemResponse>((resolve, reject) => {
						timeoutId = setTimeout(() => {
							clearTimeout(timeoutId as number);
							timeoutId = undefined;

							if (!request?.isValidTimeout) {
								return reject(
									new Error([
										`Timeout ${timeout} ms is reached for command "${command.trim()}"`,
										`without any of expected responses: ${terminators.join(', ')}`,
									].join(' '))
								);
							}

							resolve({
								command: command.trim(),
								response: [],
								reason: 'timeout',
								timeStart: timeStart,
								timeEnd: new Date(),
							});
						}, timeout);
					}),
				]))
				.finally(() => {
					if (!!timeoutId) {
						clearTimeout(timeoutId as number);
					}

					this.$port
						.unpipe(parser)
						.pipe(this._outOfProcessingParser);
				})
		);
	}
}
