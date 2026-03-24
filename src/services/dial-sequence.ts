import {CallbackQuery, Message} from 'node-telegram-bot-api';
import {IAppContext} from '../lib/context';
import {getFromId} from '../lib/telegram';

export interface IExecuteDialSequenceParameters {
	entity: Message | CallbackQuery;
	title: string;
	dialTarget: string;
	logTarget: string;
	successState: string;
	onSuccess?: (message: Message) => void;
}

export function executeDialSequence(context: IAppContext, parameters: IExecuteDialSequenceParameters): void {
	const fromId = getFromId(parameters.entity);

	if (!fromId) {
		return;
	}

	const lid = Date.now();

	context.bot.sendMessage(fromId, `⌛ ${parameters.title}: opening…`)
		.then((message) => {
			console.log(`${lid}: Open command for ${parameters.logTarget} got from ${parameters.entity.from?.username}`);

			return message;
		})
		.then((message) => {
			return (
				context.modem.send({
					command: 'ATZ',
					terminators: ['OK'],
				})
					.then(({response}) => {
						console.log(`${lid}: Modem reset`, response.map(chunk => chunk.trim()).join(' -> '));

						return message;
					})
			);
		})
		.then((message) => {
			return (
				context.modem.send({
					command: 'ATE0',
					terminators: ['OK'],
				})
					.then(({response}) => {
						console.log(`${lid}: Modem echo mode set to OFF`, response.map(chunk => chunk.trim()).join(' -> '));

						return message;
					})
			)
		})
		.then((message) => {
			return context.bot.editMessageText(`☎️ ${parameters.title}: modem connected…`, {
				chat_id: message.chat.id,
				message_id: message.message_id,
			})
				.then(() => {
					return (
						context.modem.send({
							command: 'AT+FCLASS=8',
							terminators: ['OK'],
						})
							.then(({response}) => {
								console.log(`${lid}: Modem set to voice mode`, response.map(chunk => chunk.trim()).join(' -> '));

								return message;
							})
					);
				});
		})
		.then((message) => {
			return (
				context.modem.send( {
					command: 'ATL0',
					terminators: ['OK'],
				})
					.then(({response}) => {
						console.log(`${lid}: Modem set to volume level 0`, response.map(chunk => chunk.trim()).join(' -> '));

						return message;
					})
			);
		})
		.then((message) => {
			return (
				context.modem.send({
					command: 'ATA',
					terminators: ['ATA', 'OK'],
				})
					.then(({response}) => {
						console.log(`${lid}: Modem answered to incoming call (if any)`, response.map(chunk => chunk.trim()).join(' -> '));

						return message;
					})
			);
		})
		.then((message) => {
			return (
				context.modem.send({
					command: 'ATH',
					terminators: ['OK'],
				})
					.then(({response}) => {
						console.log(`${lid}: Modem hang up incoming call`, response.map(chunk => chunk.trim()).join(' -> '));

						return message;
					})
			);
		})
		.then((message) => {
			return (
				context.modem.send( {
					command: 'ATL3',
					terminators: ['OK'],
				})
					.then(({response}) => {
						console.log(`${lid}: Modem set to volume level 3`, response.map(chunk => chunk.trim()).join(' -> '));

						return message;
					})
			);
		})
		.then((message) => {
			return (
				context.bot.editMessageText(`☎️ ${parameters.title}: calling to ${parameters.dialTarget}…`, {
					chat_id: message.chat.id,
					message_id: message.message_id,
				})
					.then(() => {
						return (
							context.modem.send({
								command: `ATm1x3DT${parameters.dialTarget}`,
								terminators: ['CONNECT', 'NO CARRIER', 'BUSY', 'OK'],
								timeout: 30000,
							})
								.then(({response}) => {
									console.log(`${lid}: Modem called to ${parameters.logTarget}`, response.map(chunk => chunk.trim()).join(' -> '));

									return message;
								})
						)
					})
			)
		})
		.then((message) => {
			return context.modem.send({
				command: 'ATH',
				terminators: ['OK'],
			})
				.then(() => {
					return message;
				});
		})
		.then((message) => {
			context.bot.editMessageText(`👍 ${parameters.title}: ${parameters.successState}`, {
				chat_id: message.chat.id,
				message_id: message.message_id,
			});

			parameters.onSuccess?.(message);
		})
		.catch((error) => {
			context.bot
				.sendMessage(fromId, `⛔ Error: ${error.message || error.toString()}`)
				.catch((failedError) => {
					console.error(failedError);
				});
		});
}
