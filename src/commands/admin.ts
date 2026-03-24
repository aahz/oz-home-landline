import {CallbackQuery, Message} from 'node-telegram-bot-api';
import {AccessLevel, IGate, IGroup, IUser, IUpsertUserInput} from '../database';
import {IAppContext} from '../lib/context';
import {getChatId, toRows} from '../lib/telegram';

export const CALLBACK_FORM_PREFIX = 'f|';

const COMMAND_ADMIN_REGEXP = (/^\/(?<command>add_user|update_user|delete_user|add_gate|update_gate|delete_gate|add_group|update_group|delete_group)\b/i);

type AdminCommand =
	| 'add_user'
	| 'update_user'
	| 'delete_user'
	| 'add_gate'
	| 'update_gate'
	| 'delete_gate'
	| 'add_group'
	| 'update_group'
	| 'delete_group';

type FlowStep =
	| 'choose_user'
	| 'choose_gate'
	| 'choose_group'
	| 'user_telegram_id'
	| 'user_name'
	| 'user_groups'
	| 'user_access'
	| 'user_notifications'
	| 'gate_id'
	| 'gate_title'
	| 'gate_group'
	| 'gate_phones'
	| 'group_id'
	| 'group_name'
	| 'confirm_delete_user'
	| 'confirm_delete_gate'
	| 'confirm_delete_group';

interface IAdminFlowState {
	command: AdminCommand;
	step: FlowStep;
	user?: Partial<IUser>;
	gate?: Partial<IGate>;
	group?: Partial<IGroup>;
	currentUser?: IUser;
	currentGate?: IGate;
	currentGroup?: IGroup;
	userGroupSelection?: string[];
}

const adminFlows = new Map<number, IAdminFlowState>();

function isAdminUser(context: IAppContext, telegramId?: number): boolean {
	if (!Number.isFinite(telegramId)) {
		return false;
	}

	return context.database.isAdmin(telegramId as number);
}

export function sendAdminError(context: IAppContext, entity: Message | CallbackQuery): void {
	const chatId = getChatId(entity);

	if (!chatId) {
		return;
	}

	context.bot.sendMessage(chatId, 'Error: Not enouth priveleges');
}

function clearFlow(userId?: number): void {
	if (!!userId) {
		adminFlows.delete(userId);
	}
}

function setFlow(userId: number, state: IAdminFlowState): void {
	adminFlows.set(userId, state);
}

function getFlow(userId?: number): IAdminFlowState | undefined {
	if (!userId) {
		return undefined;
	}

	return adminFlows.get(userId);
}

function parseBoolean(value: string): boolean {
	return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function normalizeGroupIds(groupIds: string[]): string[] {
	const normalized = Array.from(new Set(groupIds.map((groupId) => groupId.trim()).filter((groupId) => groupId.length > 0)));

	return normalized.length > 0 ? normalized : ['*'];
}

function parseDirectUserPayload(payload: string): IUpsertUserInput {
	const parts = payload.split(';').map((value) => value.trim());

	if (parts.length < 5) {
		throw new Error('Expected format: /add_user <telegramId>;<name>;<group1,group2>;<admin|user>;<true|false>');
	}

	const telegramId = Number(parts[0]);
	const accessLevel = parts[3].toLowerCase() as AccessLevel;

	if (!Number.isFinite(telegramId)) {
		throw new Error('Invalid telegramId');
	}

	if (!['admin', 'user'].includes(accessLevel)) {
		throw new Error('Invalid access level');
	}

	return {
		telegramId,
		name: parts[1],
		groupIds: normalizeGroupIds(parts[2].split(',').map((groupId) => groupId.trim())),
		accessLevel,
		isNotifications: parseBoolean(parts[4]),
	};
}

function startUserSelectionFlow(context: IAppContext, command: AdminCommand, entity: Message): void {
	const userId = entity.from?.id as number;
	const chatId = entity.chat.id;
	const users = context.database.listUsers();

	if (users.length === 0) {
		context.bot.sendMessage(chatId, 'There are no users');

		return;
	}

	setFlow(userId, {
		command,
		step: 'choose_user',
	});

	context.bot.sendMessage(chatId, 'Выберите пользователя:', {
		reply_markup: {
			inline_keyboard: toRows(
				users.map((user) => ({
					text: `${user.telegramId} - ${user.name}`,
					callback_data: `${CALLBACK_FORM_PREFIX}su|${user.telegramId}`,
				}))
			),
		},
	});
}

function startGateSelectionFlow(context: IAppContext, command: AdminCommand, entity: Message): void {
	const userId = entity.from?.id as number;
	const chatId = entity.chat.id;
	const gates = context.database.listGates();

	if (gates.length === 0) {
		context.bot.sendMessage(chatId, 'There are no gates');

		return;
	}

	setFlow(userId, {
		command,
		step: 'choose_gate',
	});

	context.bot.sendMessage(chatId, 'Выберите пропускной пункт:', {
		reply_markup: {
			inline_keyboard: toRows(
				gates.map((gate) => ({
					text: `${gate.id} - ${gate.title}`,
					callback_data: `${CALLBACK_FORM_PREFIX}sg|${gate.id}`,
				}))
			),
		},
	});
}

function startGroupSelectionFlow(context: IAppContext, command: AdminCommand, entity: Message): void {
	const userId = entity.from?.id as number;
	const chatId = entity.chat.id;
	const groups = context.database.listGroups();

	if (groups.length === 0) {
		context.bot.sendMessage(chatId, 'There are no groups');

		return;
	}

	setFlow(userId, {
		command,
		step: 'choose_group',
	});

	context.bot.sendMessage(chatId, 'Выберите группу:', {
		reply_markup: {
			inline_keyboard: toRows(
				groups.map((group) => ({
					text: `${group.id} - ${group.name}`,
					callback_data: `${CALLBACK_FORM_PREFIX}sgp|${group.id}`,
				}))
			),
		},
	});
}

function askUserTelegramId(context: IAppContext, chatId: number, currentValue?: number): void {
	context.bot.sendMessage(
		chatId,
		`Введите telegram id пользователя${Number.isFinite(currentValue) ? ` (текущее: ${currentValue})` : ''}:`
	);
}

function askUserName(context: IAppContext, chatId: number, currentValue?: string): void {
	context.bot.sendMessage(
		chatId,
		`Введите имя пользователя${currentValue ? ` (текущее: ${currentValue})` : ''}:`
	);
}

function askUserGroups(context: IAppContext, chatId: number, state: IAdminFlowState, currentGroups?: IGroup[]): void {
	const allGroups = context.database.listGroups();
	const selected = new Set(state.userGroupSelection || currentGroups?.map((group) => group.id) || []);
	state.userGroupSelection = Array.from(selected);

	const groupButtons = allGroups.map((group) => {
		const isSelected = selected.has(group.id);

		return {
			text: `${isSelected ? '✅ ' : ''}${group.id} - ${group.name}`,
			callback_data: `${CALLBACK_FORM_PREFIX}ugs|${group.id}`,
		};
	});

	context.bot.sendMessage(
		chatId,
		'Выберите группы пользователя (можно несколько):',
		{
			reply_markup: {
				inline_keyboard: [
					...toRows(groupButtons, 1),
					[{text: 'Done', callback_data: `${CALLBACK_FORM_PREFIX}ugd|done`}],
				],
			},
		}
	);
}

function askUserAccess(context: IAppContext, chatId: number, currentValue?: AccessLevel): void {
	context.bot.sendMessage(
		chatId,
		`Выберите уровень доступа${currentValue ? ` (текущий: ${currentValue})` : ''}:`,
		{
			reply_markup: {
				inline_keyboard: [[
					{text: 'admin', callback_data: `${CALLBACK_FORM_PREFIX}ua|admin`},
					{text: 'user', callback_data: `${CALLBACK_FORM_PREFIX}ua|user`},
				]],
			},
		}
	);
}

function askUserNotifications(context: IAppContext, chatId: number, currentValue?: boolean): void {
	context.bot.sendMessage(
		chatId,
		`Получать security-уведомления?${typeof currentValue === 'boolean' ? ` (текущее: ${currentValue ? 'true' : 'false'})` : ''}:`,
		{
			reply_markup: {
				inline_keyboard: [[
					{text: 'true', callback_data: `${CALLBACK_FORM_PREFIX}un|true`},
					{text: 'false', callback_data: `${CALLBACK_FORM_PREFIX}un|false`},
				]],
			},
		}
	);
}

function askGateId(context: IAppContext, chatId: number, currentValue?: string): void {
	context.bot.sendMessage(
		chatId,
		`Введите id пропускного пункта${currentValue ? ` (текущий: ${currentValue})` : ''}:`
	);
}

function askGateTitle(context: IAppContext, chatId: number, currentValue?: string): void {
	context.bot.sendMessage(
		chatId,
		`Введите название пропускного пункта${currentValue ? ` (текущее: ${currentValue})` : ''}:`
	);
}

function askGateGroup(context: IAppContext, chatId: number, currentGroup?: IGroup): void {
	const groups = context.database.listGroups().filter((group) => group.id !== '*');

	context.bot.sendMessage(
		chatId,
		`Выберите группу пропускного пункта${currentGroup ? ` (текущая: ${currentGroup.id} - ${currentGroup.name})` : ''}:`,
		{
			reply_markup: {
				inline_keyboard: toRows(
					groups.map((group) => ({
						text: `${group.id} - ${group.name}`,
						callback_data: `${CALLBACK_FORM_PREFIX}ggs|${group.id}`,
					}))
				),
			},
		}
	);
}

function askGatePhones(context: IAppContext, chatId: number, currentValue?: string[]): void {
	context.bot.sendMessage(
		chatId,
		`Введите телефоны через запятую${currentValue?.length ? ` (текущие: ${currentValue.join(',')})` : ''}:`
	);
}

function askGroupId(context: IAppContext, chatId: number, currentValue?: string): void {
	context.bot.sendMessage(chatId, `Введите id группы${currentValue ? ` (текущий: ${currentValue})` : ''}:`);
}

function askGroupName(context: IAppContext, chatId: number, currentValue?: string): void {
	context.bot.sendMessage(chatId, `Введите name группы${currentValue ? ` (текущий: ${currentValue})` : ''}:`);
}

function askDeleteUserConfirm(context: IAppContext, chatId: number, user: Partial<IUser>): void {
	context.bot.sendMessage(
		chatId,
		`Удалить пользователя ${user.telegramId} - ${user.name}?`,
		{
			reply_markup: {
				inline_keyboard: [[
					{text: 'Yes', callback_data: `${CALLBACK_FORM_PREFIX}du|yes`},
					{text: 'No', callback_data: `${CALLBACK_FORM_PREFIX}du|no`},
				]],
			},
		}
	);
}

function askDeleteGateConfirm(context: IAppContext, chatId: number, gate: Partial<IGate>): void {
	context.bot.sendMessage(
		chatId,
		`Удалить пропускной пункт ${gate.id} - ${gate.title}?`,
		{
			reply_markup: {
				inline_keyboard: [[
					{text: 'Yes', callback_data: `${CALLBACK_FORM_PREFIX}dg|yes`},
					{text: 'No', callback_data: `${CALLBACK_FORM_PREFIX}dg|no`},
				]],
			},
		}
	);
}

function askDeleteGroupConfirm(context: IAppContext, chatId: number, group: Partial<IGroup>): void {
	context.bot.sendMessage(
		chatId,
		`Удалить группу ${group.id} - ${group.name}?`,
		{
			reply_markup: {
				inline_keyboard: [[
					{text: 'Yes', callback_data: `${CALLBACK_FORM_PREFIX}dgp|yes`},
					{text: 'No', callback_data: `${CALLBACK_FORM_PREFIX}dgp|no`},
				]],
			},
		}
	);
}

function startAdminFlow(context: IAppContext, command: AdminCommand, entity: Message): void {
	const userId = entity.from?.id as number;
	const chatId = entity.chat.id;

	clearFlow(userId);

	if (command === 'add_user') {
		setFlow(userId, {
			command,
			step: 'user_telegram_id',
			user: {},
			userGroupSelection: [],
		});
		askUserTelegramId(context, chatId);
		return;
	}

	if (command === 'add_gate') {
		setFlow(userId, {
			command,
			step: 'gate_id',
			gate: {},
		});
		askGateId(context, chatId);
		return;
	}

	if (command === 'add_group') {
		setFlow(userId, {
			command,
			step: 'group_id',
			group: {},
		});
		askGroupId(context, chatId);
		return;
	}

	if (command === 'update_user' || command === 'delete_user') {
		startUserSelectionFlow(context, command, entity);
		return;
	}

	if (command === 'update_gate' || command === 'delete_gate') {
		startGateSelectionFlow(context, command, entity);
		return;
	}

	if (command === 'update_group' || command === 'delete_group') {
		startGroupSelectionFlow(context, command, entity);
		return;
	}
}

function parseGatePhones(value: string): string[] {
	return value
		.split(',')
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

export function handleAdminCommandMessage(context: IAppContext, message: Message): boolean {
	const text = String(message.text || '').trim();
	const commandMatch = COMMAND_ADMIN_REGEXP.exec(text);

	if (!commandMatch?.groups?.command) {
		return false;
	}

	if (!isAdminUser(context, message.from?.id)) {
		sendAdminError(context, message);
		return true;
	}

	const command = commandMatch.groups.command as AdminCommand;
	const payload = text.replace(/^\/[a-z_]+\s*/i, '').trim();

	try {
		if ((command === 'add_user' || command === 'update_user') && payload.length > 0) {
			const user = parseDirectUserPayload(payload);

			if (command === 'add_user') {
				context.database.addUser(user);
				context.bot.sendMessage(message.chat.id, `User ${user.telegramId} has been added`);
			} else {
				context.database.updateUser(user);
				context.bot.sendMessage(message.chat.id, `User ${user.telegramId} has been updated`);
			}

			return true;
		}
	} catch (error: any) {
		context.bot.sendMessage(message.chat.id, `Error: ${error.message || error.toString()}`);
		return true;
	}

	startAdminFlow(context, command, message);

	return true;
}

export function processAdminFlowText(context: IAppContext, message: Message): boolean {
	const userId = message.from?.id;
	const state = getFlow(userId);

	if (!state) {
		return false;
	}

	const text = String(message.text || '').trim();
	const chatId = message.chat.id;

	try {
		if (state.step === 'user_telegram_id') {
			const telegramId = Number(text);
			if (!Number.isFinite(telegramId)) {
				throw new Error('Неверный telegram id');
			}
			state.user = {...state.user, telegramId};
			state.step = 'user_name';
			setFlow(userId as number, state);
			askUserName(context, chatId);
			return true;
		}

		if (state.step === 'user_name') {
			if (!text.length) {
				throw new Error('Имя не может быть пустым');
			}
			state.user = {...state.user, name: text};
			state.step = 'user_groups';
			setFlow(userId as number, state);
			askUserGroups(context, chatId, state, state.currentUser?.groups);
			return true;
		}

		if (state.step === 'gate_id') {
			if (!text.length) {
				throw new Error('id не может быть пустым');
			}
			state.gate = {...state.gate, id: text};
			state.step = 'gate_title';
			setFlow(userId as number, state);
			askGateTitle(context, chatId);
			return true;
		}

		if (state.step === 'gate_title') {
			if (!text.length) {
				throw new Error('Название не может быть пустым');
			}
			state.gate = {...state.gate, title: text};
			state.step = 'gate_group';
			setFlow(userId as number, state);
			askGateGroup(context, chatId, state.currentGate?.group);
			return true;
		}

		if (state.step === 'gate_phones') {
			const phoneNumbers = parseGatePhones(text);
			if (!phoneNumbers.length) {
				throw new Error('Укажите хотя бы один номер');
			}
			state.gate = {...state.gate, phoneNumbers};
			setFlow(userId as number, state);

			if (state.command === 'add_gate') {
				context.database.addGate({
					id: state.gate.id as string,
					title: state.gate.title as string,
					groupId: state.gate.group?.id as string,
					phoneNumbers: state.gate.phoneNumbers as string[],
				});
				clearFlow(userId);
				context.bot.sendMessage(chatId, `Gate ${state.gate.id} has been added`);
				return true;
			}

			if (state.command === 'update_gate') {
				context.database.updateGate({
					id: state.gate.id as string,
					title: state.gate.title as string,
					groupId: state.gate.group?.id as string,
					phoneNumbers: state.gate.phoneNumbers as string[],
				});
				clearFlow(userId);
				context.bot.sendMessage(chatId, `Gate ${state.gate.id} has been updated`);
				return true;
			}
		}

		if (state.step === 'group_id') {
			if (!text.length) {
				throw new Error('id не может быть пустым');
			}
			state.group = {...state.group, id: text};
			state.step = 'group_name';
			setFlow(userId as number, state);
			askGroupName(context, chatId);
			return true;
		}

		if (state.step === 'group_name') {
			if (!text.length) {
				throw new Error('name не может быть пустым');
			}
			state.group = {...state.group, name: text};
			setFlow(userId as number, state);

			if (state.command === 'add_group') {
				context.database.addGroup({
					id: state.group.id as string,
					name: state.group.name as string,
				});
				clearFlow(userId);
				context.bot.sendMessage(chatId, `Group ${state.group.id} has been added`);
				return true;
			}

			if (state.command === 'update_group') {
				context.database.updateGroup({
					id: state.group.id as string,
					name: state.group.name as string,
				});
				clearFlow(userId);
				context.bot.sendMessage(chatId, `Group ${state.group.id} has been updated`);
				return true;
			}
		}
	} catch (error: any) {
		context.bot.sendMessage(chatId, `Error: ${error.message || error.toString()}`);
		return true;
	}

	context.bot.sendMessage(chatId, 'Используйте кнопки из формы');
	return true;
}

export function processAdminFlowCallback(context: IAppContext, query: CallbackQuery): boolean {
	const data = String(query.data || '');

	if (!data.startsWith(CALLBACK_FORM_PREFIX)) {
		return false;
	}

	const userId = query.from?.id as number;
	const chatId = query.message?.chat?.id as number;
	const state = getFlow(userId);
	const payload = data.substring(CALLBACK_FORM_PREFIX.length).split('|');
	const action = payload[0];
	const value = payload[1];

	context.bot.answerCallbackQuery(query.id).catch(() => undefined);

	if (!state) {
		context.bot.sendMessage(chatId, 'Error: Form session is expired');
		return true;
	}

	try {
		if (action === 'su' && state.step === 'choose_user') {
			const selectedUser = context.database.listUsers().find((user) => user.telegramId === Number(value));
			if (!selectedUser) {
				throw new Error(`User ${value} is not found`);
			}
			state.user = {...selectedUser};
			state.currentUser = selectedUser;
			state.userGroupSelection = selectedUser.groups.map((group) => group.id);

			if (state.command === 'update_user') {
				state.step = 'user_name';
				setFlow(userId, state);
				askUserName(context, chatId, selectedUser.name);
				return true;
			}

			if (state.command === 'delete_user') {
				state.step = 'confirm_delete_user';
				setFlow(userId, state);
				askDeleteUserConfirm(context, chatId, state.user);
				return true;
			}
		}

		if (action === 'sg' && state.step === 'choose_gate') {
			const selectedGate = context.database.getGateById(value);
			if (!selectedGate) {
				throw new Error(`Gate ${value} is not found`);
			}
			state.gate = {...selectedGate};
			state.currentGate = selectedGate;

			if (state.command === 'update_gate') {
				state.step = 'gate_title';
				setFlow(userId, state);
				askGateTitle(context, chatId, selectedGate.title);
				return true;
			}

			if (state.command === 'delete_gate') {
				state.step = 'confirm_delete_gate';
				setFlow(userId, state);
				askDeleteGateConfirm(context, chatId, state.gate);
				return true;
			}
		}

		if (action === 'sgp' && state.step === 'choose_group') {
			const selectedGroup = context.database.getGroupById(value);
			if (!selectedGroup) {
				throw new Error(`Group ${value} is not found`);
			}
			state.group = {...selectedGroup};
			state.currentGroup = selectedGroup;

			if (state.command === 'update_group') {
				state.step = 'group_name';
				setFlow(userId, state);
				askGroupName(context, chatId, selectedGroup.name);
				return true;
			}

			if (state.command === 'delete_group') {
				state.step = 'confirm_delete_group';
				setFlow(userId, state);
				askDeleteGroupConfirm(context, chatId, state.group);
				return true;
			}
		}

		if (action === 'ugs' && state.step === 'user_groups') {
			const selected = new Set(state.userGroupSelection || []);
			if (selected.has(value)) {
				selected.delete(value);
			} else {
				selected.add(value);
			}
			state.userGroupSelection = Array.from(selected);
			setFlow(userId, state);
			askUserGroups(context, chatId, state, state.currentUser?.groups);
			return true;
		}

		if (action === 'ugd' && state.step === 'user_groups') {
			const groupIds = normalizeGroupIds(state.userGroupSelection || []);
			state.user = {
				...state.user,
				groups: groupIds.map((groupId) => ({id: groupId, name: groupId})),
			};
			state.step = 'user_access';
			setFlow(userId, state);
			askUserAccess(context, chatId, state.currentUser?.accessLevel);
			return true;
		}

		if (action === 'ua' && state.step === 'user_access') {
			const accessLevel = String(value).toLowerCase() as AccessLevel;
			if (!['admin', 'user'].includes(accessLevel)) {
				throw new Error('Invalid access level');
			}
			state.user = {...state.user, accessLevel};
			state.step = 'user_notifications';
			setFlow(userId, state);
			askUserNotifications(context, chatId, state.currentUser?.isNotifications);
			return true;
		}

		if (action === 'un' && state.step === 'user_notifications') {
			const groupIds = normalizeGroupIds((state.user?.groups || []).map((group) => group.id));
			state.user = {...state.user, isNotifications: parseBoolean(value)};
			setFlow(userId, state);

			if (state.command === 'add_user') {
				context.database.addUser({
					telegramId: state.user.telegramId as number,
					name: state.user.name as string,
					groupIds,
					accessLevel: state.user.accessLevel as AccessLevel,
					isNotifications: state.user.isNotifications as boolean,
				});
				clearFlow(userId);
				context.bot.sendMessage(chatId, `User ${state.user.telegramId} has been added`);
				return true;
			}

			if (state.command === 'update_user') {
				context.database.updateUser({
					telegramId: state.user.telegramId as number,
					name: state.user.name as string,
					groupIds,
					accessLevel: state.user.accessLevel as AccessLevel,
					isNotifications: state.user.isNotifications as boolean,
				});
				clearFlow(userId);
				context.bot.sendMessage(chatId, `User ${state.user.telegramId} has been updated`);
				return true;
			}
		}

		if (action === 'ggs' && state.step === 'gate_group') {
			const group = context.database.getGroupById(value);
			if (!group) {
				throw new Error('Group is not found');
			}
			state.gate = {...state.gate, group};
			state.step = 'gate_phones';
			setFlow(userId, state);
			askGatePhones(context, chatId, state.currentGate?.phoneNumbers);
			return true;
		}

		if (action === 'du' && state.step === 'confirm_delete_user') {
			if (value === 'yes') {
				context.database.deleteUser(state.user?.telegramId as number);
				clearFlow(userId);
				context.bot.sendMessage(chatId, `User ${state.user?.telegramId} has been deleted`);
				return true;
			}
			clearFlow(userId);
			context.bot.sendMessage(chatId, 'Delete cancelled');
			return true;
		}

		if (action === 'dg' && state.step === 'confirm_delete_gate') {
			if (value === 'yes') {
				context.database.deleteGate(state.gate?.id as string);
				clearFlow(userId);
				context.bot.sendMessage(chatId, `Gate ${state.gate?.id} has been deleted`);
				return true;
			}
			clearFlow(userId);
			context.bot.sendMessage(chatId, 'Delete cancelled');
			return true;
		}

		if (action === 'dgp' && state.step === 'confirm_delete_group') {
			if (value === 'yes') {
				context.database.deleteGroup(state.group?.id as string);
				clearFlow(userId);
				context.bot.sendMessage(chatId, `Group ${state.group?.id} has been deleted`);
				return true;
			}
			clearFlow(userId);
			context.bot.sendMessage(chatId, 'Delete cancelled');
			return true;
		}
	} catch (error: any) {
		context.bot.sendMessage(chatId, `Error: ${error.message || error.toString()}`);
		clearFlow(userId);
		return true;
	}

	context.bot.sendMessage(chatId, 'Error: Invalid form action');
	return true;
}
