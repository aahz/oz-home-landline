import TBot, {User as ITBotUser, Message as ITBotMessage, CallbackQuery as ITBotCallbackQuery} from 'node-telegram-bot-api';

import * as C from './constants';

export interface IBotParameters {
	token: string;
}

export type TMessageProcessor = (api: TBot, message: ITBotMessage) => void;

export type TCallbackQueryProcessor = (api: TBot, query: ITBotCallbackQuery) => void;

export class Bot {
	protected readonly $api: TBot;

	protected readonly $messageProcessors: Set<TMessageProcessor> = new Set();

	protected readonly $callbackQueryProcessors: Set<TCallbackQueryProcessor> = new Set();

	public get api(): TBot {
		return this.$api;
	}

	public constructor(parameters: IBotParameters) {
		this.$api = new TBot(parameters.token, {
			polling: true,
		});

		this.$api.on('message', (message) => {
			this.$executeGuarded(
				(api: TBot, message: ITBotMessage) => {
					for (const messageProcessor of this.$messageProcessors) {
						try {
							messageProcessor(api, message);
						}
						catch (error) {
							console.error(error);
						}
					}
				},
				[this.$api, message],
				message
			);
		});

		this.$api.on('callback_query', (query) => {
			this.$executeGuarded(
				(api, query) => {
					for (const callbackQueryProcessor of this.$callbackQueryProcessors) {
						try {
							callbackQueryProcessor(api, query);
						}
						catch (error) {
							console.error(error);
						}
					}
				},
				[this.$api, query],
				query
			);
		});
	}

	protected $executeGuarded = (
		task: (...args: any[]) => void,
		args: any[],
		input: {from?: ITBotUser;}
	): void => {
		if (C.BOT.ALLOWED_USER_IDS.length > 0 && !C.BOT.ALLOWED_USER_IDS.includes(input.from?.id as number)) {
			for (const userId of C.BOT.ALLOWED_USER_IDS) {
				this.$api.sendMessage(
					userId,
					`Untrusted user ${input.from?.first_name} ${input.from?.last_name} (@${input.from?.username}, \`${input.from?.id}\`) trying to get access to GateKeeper. If you want to authorize this user tell administrator to add this user ID to white list.`
				);
			}

			this.$api
				.sendMessage(input.from?.id as number, 'Error: There is nothing to do here.')

			return;
		}

		task.apply(this, args);
	}

	public addMessageProcessor(processor: TMessageProcessor): this {
		this.$messageProcessors.add(processor);

		return this;
	}

	public removeMessageProcessor(processor: TMessageProcessor): this {
		this.$messageProcessors.delete(processor);

		return this;
	}

	public addCallbackQueryProcessor(processor: TCallbackQueryProcessor): this {
		this.$callbackQueryProcessors.add(processor);

		return this;
	}

	public removeCallbackQueryProcessor(processor: TCallbackQueryProcessor): this {
		this.$callbackQueryProcessors.delete(processor);

		return this;
	}
}
