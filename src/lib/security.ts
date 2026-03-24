import {CallbackQuery, Message} from 'node-telegram-bot-api';
import {IUpsertUserInput} from '../database';
import {IAppContext} from './context';

const SECURITY_ADD_USER_CALLBACK_PREFIX = 'sec|add|';

interface IPendingSecurityAdd {
	user: IUpsertUserInput;
	command: string;
}

const pendingSecurityAdds = new Map<string, IPendingSecurityAdd>();

export function isAllowedUser(context: IAppContext, telegramId?: number): boolean {
	if (!Number.isFinite(telegramId)) {
		return false;
	}

	return context.database.hasUser(telegramId as number);
}

export function isAdminUser(context: IAppContext, telegramId?: number): boolean {
	if (!Number.isFinite(telegramId)) {
		return false;
	}

	return context.database.isAdmin(telegramId as number);
}

export function processSecurityCallback(context: IAppContext, query: CallbackQuery): boolean {
	const data = String(query.data || '');

	if (!data.startsWith(SECURITY_ADD_USER_CALLBACK_PREFIX)) {
		return false;
	}

	if (!isAdminUser(context, query.from?.id)) {
		context.bot.answerCallbackQuery(query.id, {text: 'Error: Not enouth priveleges'});

		return true;
	}

	const token = data.substring(SECURITY_ADD_USER_CALLBACK_PREFIX.length);
	const pending = pendingSecurityAdds.get(token);

	if (!pending) {
		context.bot.answerCallbackQuery(query.id, {text: 'Error: Request expired'});

		return true;
	}

	try {
		context.database.addUser(pending.user);
		pendingSecurityAdds.delete(token);
		context.bot.sendMessage(query.message?.chat?.id as number, `User ${pending.user.telegramId} has been added`);
		context.bot.answerCallbackQuery(query.id, {text: 'User added'});
	} catch (error: any) {
		context.bot.answerCallbackQuery(query.id, {text: 'Error'});
		context.bot.sendMessage(query.message?.chat?.id as number, `Error: ${error.message || error.toString()}`);
	}

	return true;
}

export function notifyUntrustedMessage(context: IAppContext, message: Message): void {
	const payload = buildPendingUser(message.from?.id as number, message.from?.first_name, message.from?.last_name, message.from?.username);

	notifyAdmins(context, payload, [
		`Untrusted user ${message.from?.first_name} ${message.from?.last_name} (@${message.from?.username}, \`${message.from?.id}\`) trying to get access to Landline.`,
		'If you want to authorize this user tell administrator to add this user ID to white list.',
	]);

	context.bot.sendMessage(message?.chat?.id, 'Error: [500] Internal server error');
}

export function notifyUntrustedCallback(context: IAppContext, query: CallbackQuery): void {
	const payload = buildPendingUser(query.from?.id as number, query.from?.first_name, query.from?.last_name, query.from?.username);

	notifyAdmins(context, payload, [
		`Untrusted user ${query.from?.first_name} ${query.from?.last_name} (@${query.from?.username}, \`${query.from?.id}\`) trying to get access to Landline.`,
		'If you want to authorize this user tell administrator to add this user ID to white list.',
	]);

	context.bot
		.sendMessage(
			query?.message?.chat?.id as number,
			'Error: [500] Internal server error'
		);
}

function notifyAdmins(context: IAppContext, payload: IPendingSecurityAdd, details: string[]): void {
	const recipients = context.database.getNotifiableAdmins();

	Promise.all(
		recipients.map((user) => context.bot.sendMessage(
			user.telegramId,
			[
				...details,
				`Suggested command: ${payload.command}`,
			].join('\n'),
			{
				reply_markup: {
					inline_keyboard: [[
						{
							text: 'Add user',
							callback_data: `${SECURITY_ADD_USER_CALLBACK_PREFIX}${createPendingToken(payload)}`,
						}
					]],
				},
			}
		))
	)
		.catch((error) => {
			console.error(error);
		});
}

function buildPendingUser(telegramId: number, firstName?: string, lastName?: string, username?: string): IPendingSecurityAdd {
	const name = [firstName, lastName]
		.filter((chunk) => !!chunk && chunk.trim().length > 0)
		.join(' ')
		.trim() || (username ? `@${username}` : `User ${telegramId}`);

	const safeName = sanitizeForCommand(name);

	const user: IUpsertUserInput = {
		telegramId,
		name: safeName,
		groupIds: ['user'],
		accessLevel: 'user',
		isNotifications: false,
	};

	return {
		user,
		command: `/add_user ${user.telegramId};${user.name};${user.groupIds.join(',')};${user.accessLevel};${user.isNotifications}`,
	};
}

function sanitizeForCommand(value: string): string {
	return value.replace(/[;\n\r]+/g, ' ').trim();
}

function createPendingToken(payload: IPendingSecurityAdd): string {
	const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
	pendingSecurityAdds.set(token, payload);

	return token;
}
