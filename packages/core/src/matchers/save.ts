import * as M from '@meetalva/message';
import * as ModelTree from '@meetalva/model-tree';
import * as T from '@meetalva/types';
import { Persistence } from '../persistence';
import * as Path from 'path';
import * as uuid from 'uuid';
import { MatcherCreator } from './context';

export interface SaveConfig {
	passive: boolean;
}

export const save: MatcherCreator<M.Save, SaveConfig> = (
	{ host, dataHost },
	config?: SaveConfig
) => {
	return async m => {
		const app = await host.getApp(m.appId || '');

		if (!app) {
			host.log(`save: received message without resolveable app:`, m);
			return;
		}

		const project = await dataHost.getProject(m.payload.projectId);

		if (!project) {
			host.log(`save: received message without resolveable project:`, m);
			return;
		}

		const name = project.getName() !== project.toJSON().id ? project.getName() : 'New Project';

		const targetPath = m.payload.publish
			? await host.selectSaveFile({
					title: 'Save Alva File',
					defaultPath: `${name}.alva`,
					filters: [
						{
							name: 'Alva File',
							extensions: ['alva']
						}
					]
			  })
			: project.getPath();

		if (!targetPath) {
			host.log(`save: not target path:`, m);
			return;
		}

		const serializeResult = await Persistence.serialize(project);

		if (serializeResult.state !== T.PersistenceState.Success) {
			host.log(serializeResult.error.message);

			app.send({
				type: M.MessageType.ShowError,
				transaction: m.transaction,
				id: m.id,
				payload: {
					message: `Sorry, we had trouble writing this project to ${targetPath}`,
					detail: `It failed with: ${serializeResult.error.message}`,
					error: {
						message: serializeResult.error.message,
						stack: serializeResult.error.stack || ''
					}
				}
			});

			return;
		}

		project.setPath(targetPath);
		project.setDraft(project.getDraft() ? !m.payload.publish : false);

		if (!project.getDraft()) {
			project.setName(Path.basename(targetPath, Path.extname(targetPath)));
		}

		await dataHost.addProject(project);

		if (typeof window === 'undefined') {
			project.sync(await host.getSender(), ModelTree);
		}

		try {
			await host.mkdir(Path.dirname(targetPath));
			await host.writeFile(targetPath, serializeResult.contents);

			if (config && config.passive) {
				return;
			}

			app.send({
				type: M.MessageType.SaveResult,
				transaction: m.transaction,
				id: uuid.v4(),
				payload: {
					previous: m.payload.projectId,
					project: {
						id: project.getId(),
						path: project.getPath(),
						draft: project.getDraft(),
						name: project.getName()
					}
				}
			});
		} catch (err) {
			host.log(err.message);

			app.send({
				type: M.MessageType.ShowError,
				transaction: m.transaction,
				id: m.id,
				payload: {
					message: `Sorry, we had trouble writing this project to ${targetPath}`,
					detail: `It failed with: ${err.message}`,
					error: {
						message: err.message,
						stack: err.stack || ''
					}
				}
			});
		}
	};
};
