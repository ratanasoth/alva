import { ElementArea } from './element-area';
import * as Mobx from 'mobx';
import * as Message from '@meetalva/message';
import * as Model from '@meetalva/model';
import { Sender } from '../sender';
import * as Types from '@meetalva/types';
import * as uuid from 'uuid';

export type RequestIdleCallbackHandle = number;

export interface RequestIdleCallbackOptions {
	timeout: number;
}

export interface RequestIdleCallbackDeadline {
	readonly didTimeout: boolean;
	timeRemaining: (() => number);
}

declare global {
	interface Window {
		requestIdleCallback: ((
			callback: ((deadline: RequestIdleCallbackDeadline) => void),
			opts?: RequestIdleCallbackOptions
		) => RequestIdleCallbackHandle);
		cancelIdleCallback: ((handle: RequestIdleCallbackHandle) => void);
	}
}

export interface PreviewStoreInit<V, T extends Types.PreviewDocumentMode> {
	components: Components;
	highlightArea: ElementArea;
	mode: T;
	project: Model.Project;
	selectionArea: ElementArea;
}

export interface Components {
	// tslint:disable-next-line:no-any
	[id: string]: any;
}

export interface SyntheticComponents<V> {
	'synthetic:box': V;
	'synthetic:conditional': V;
	'synthetic:page': V;
	'synthetic:image': V;
	'synthetic:link': V;
	'synthetic:text': V;
}

export class PreviewStore<V> {
	@Mobx.observable private app?: Model.AlvaApp<Message.Message>;
	@Mobx.observable private highlightArea: ElementArea;
	@Mobx.observable private metaDown: boolean = false;
	@Mobx.observable private mode: Types.PreviewDocumentMode;
	@Mobx.observable private project: Model.Project;
	@Mobx.observable private selectionArea: ElementArea;
	@Mobx.observable private scrollPosition?: Types.Point;

	private sender?: Sender;
	private components: Components;

	public constructor(init: PreviewStoreInit<V, Types.PreviewDocumentMode>) {
		this.mode = init.mode;
		this.project = init.project;
		this.components = init.components;
		this.selectionArea = init.selectionArea;
		this.highlightArea = init.highlightArea;
	}

	public getActivePage(): Model.Page | undefined {
		return this.project.getPages().find(page => page.getActive());
	}

	public getChildren<T>(
		element: Model.Element,
		render: (element: Model.Element) => T
	): T[] | null {
		const childContent = element.getContentBySlotType(Types.SlotType.Children);

		if (!childContent) {
			return null;
		}

		const slot = childContent.getSlot();

		if (!slot) {
			return null;
		}

		const elements = childContent.getElements();

		if (elements.length === 0 && !slot.getRequired()) {
			return null;
		}

		return elements.map(render);
	}

	public getComponent(element: Model.Element): V | undefined {
		const pattern = element.getPattern();

		if (!pattern) {
			return;
		}

		const component: unknown = this.components[pattern.getId()];

		if (typeof component !== 'object' || component === null) {
			throw new Error(
				`Could not find component with id "${pattern.getId()}" for pattern "${pattern.getName()}:${pattern.getExportName()}".`
			);
		}

		const exportName = pattern.getExportName();

		if (!component.hasOwnProperty(exportName)) {
			if (typeof component !== 'object') {
				throw new Error(
					`Could not find export ${exportName} on pattern "${pattern.getName()}:${pattern.getExportName()}".`
				);
			}
		}

		const c = component as { [key: string]: unknown };
		return c[exportName] as V | undefined;
	}

	public getElementById(id: string): Model.Element | undefined {
		return this.project.getElementById(id);
	}

	public getHighlightedElement(): Model.Element | undefined {
		return this.project.getHighlightedElements()[0];
	}

	public getHighlightedElementContent(): Model.ElementContent | undefined {
		return this.project.getHighlightedElementContents()[0];
	}

	public getHighlightArea(): ElementArea {
		return this.highlightArea;
	}

	public getMetaDown(): boolean {
		return this.metaDown;
	}

	public getProperties<T>(
		element: Model.Element
	): { [propName: string]: Types.ElementPropertyValue } {
		return element
			.getProperties()
			.reduce<{ [key: string]: any }>((renderProperties, elementProperty) => {
				const patternProperty = elementProperty.getPatternProperty();

				if (!patternProperty) {
					return renderProperties;
				}

				if (patternProperty.getType() === Types.PatternPropertyType.EventHandler) {
					const property = patternProperty as Model.PatternEventHandlerProperty;
					const event = property.getEvent();

					renderProperties[patternProperty.getPropertyName()] = (e: Event) => {
						if (event.getType() === Types.PatternEventType.MouseEvent) {
							if (this.mode !== Types.PreviewDocumentMode.Static && !this.getMetaDown()) {
								return;
							}
						}

						const actionIds = elementProperty.getValue() as unknown;

						if (!actionIds) {
							return;
						}

						const elementActions = Array.isArray(actionIds)
							? actionIds.map(id => this.project.getElementActionById(id)).filter(Boolean)
							: typeof actionIds === 'string'
								? [this.project.getElementActionById(actionIds)]
								: [];

						elementActions.forEach(action => {
							if (!action) {
								return;
							}
							action.execute({
								sender: this.app || this.sender,
								project: this.getProject(),
								event: e
							});
						});
					};
				} else {
					renderProperties[patternProperty.getPropertyName()] = elementProperty.getValue();
				}

				return renderProperties;
			}, {});
	}

	public getProject(): Model.Project {
		return this.project;
	}

	public getSelectedElement(): Model.Element | undefined {
		return this.project.getElements().find(element => element.getSelected());
	}

	public getSelectionArea(): ElementArea {
		return this.selectionArea;
	}

	public getSlots<T>(
		element: Model.Element,
		render: (element: Model.Element) => T
	): { [propName: string]: T[] | null } {
		return element
			.getContents()
			.filter(content => content.getSlotType() !== Types.SlotType.Children)
			.reduce<{ [key: string]: T[] | null }>((renderProperties, content) => {
				const slot = content.getSlot();

				if (!slot) {
					return renderProperties;
				}

				const elements = content.getElements();
				const children =
					elements.length === 0 && !slot.getRequired() ? null : elements.map(render);

				renderProperties[slot.getPropertyName()] = children;
				return renderProperties;
			}, {});
	}

	public getScrollPosition(): Types.Point {
		return this.scrollPosition || { x: 0, y: 0 };
	}

	public getSender(): Sender | undefined {
		return this.sender;
	}

	public hasHighlightedItem(): boolean {
		return Boolean(this.getHighlightedElement() || this.getHighlightedElementContent());
	}

	public hasSelectedItem(): boolean {
		return Boolean(this.getSelectedElement());
	}

	@Mobx.action
	public onElementClick(e: MouseEvent, data: { element: Model.Element; node?: Element }): void {
		if (this.mode !== Types.PreviewDocumentMode.Static) {
			e.preventDefault();
		}

		if (e.metaKey || this.mode === Types.PreviewDocumentMode.Static) {
			return;
		}

		e.preventDefault();
		e.stopPropagation();

		this.updateSelectedElement(data);

		if (data.element.getRole() === Types.ElementRole.Root) {
			this.project.unsetSelectedElement();
		} else {
			this.project.setSelectedElement(data.element);
		}

		if (this.sender) {
			this.sender.send({
				appId: this.app ? this.app.getId() : undefined,
				type: Message.MessageType.SelectElement,
				id: uuid.v4(),
				payload: { element: data.element.toJSON(), projectId: this.project.getId() }
			});
		}
	}

	@Mobx.action
	public onElementMouseOver(
		e: MouseEvent,
		data: { element: Model.Element; node?: Element }
	): void {
		if (this.mode !== Types.PreviewDocumentMode.Live) {
			return;
		}

		this.updateHighlightedElement(data);

		if (data.element.getRole() === Types.ElementRole.Root) {
			this.project.unsetHighlightedElement();
		} else {
			this.setHighlightedElement(data.element);
		}

		if (this.sender) {
			this.sender.send({
				appId: this.app ? this.app.getId() : undefined,
				type: Message.MessageType.HighlightElement,
				id: uuid.v4(),
				payload: { element: data.element.toJSON() }
			});
		}
	}

	@Mobx.action
	public updateHighlightedElement(data: { element: Model.Element; node?: Element }): void {
		if (this.mode !== Types.PreviewDocumentMode.Live) {
			return;
		}

		this.highlightArea.setElement(data.node);

		if (data.element.getRole() === Types.ElementRole.Root) {
			this.highlightArea.hide();
		} else {
			this.highlightArea.show();
		}
	}

	@Mobx.action
	public updateSelectedElement(data: { element: Model.Element; node?: Element }): void {
		if (this.mode !== Types.PreviewDocumentMode.Live) {
			return;
		}

		this.selectionArea.setElement(data.node);

		if (data.element.getRole() === Types.ElementRole.Root) {
			this.selectionArea.hide();
		} else {
			this.selectionArea.show();
		}
	}

	@Mobx.action
	public onHighlightedElementRemove(data: { element: Model.Element; node?: Element }): void {
		if (this.mode !== Types.PreviewDocumentMode.Live) {
			return;
		}

		this.project.unsetHighlightedElement();
		this.project.unsetHighlightedElementContent();
	}

	public onOutsideClick(e: MouseEvent): void {
		if (this.mode !== Types.PreviewDocumentMode.Live) {
			return;
		}

		this.project.unsetSelectedElement();
		this.project.unsetHighlightedElement();
		this.project.unsetHighlightedElementContent();
	}

	@Mobx.action
	public setActivePage(page: Model.Page): void {
		this.project.getPages().forEach(p => p.setActive(false));
		page.setActive(true);
	}

	@Mobx.action
	public setComponents(components: Components): void {
		this.components = components;
	}

	@Mobx.action
	public setHighlightedElement(element: Model.Element): void {
		if (element.getRole() === Types.ElementRole.Root) {
			return;
		}

		element.setHighlighted(true);
	}

	@Mobx.action
	public setMetaDown(metaDown: boolean): void {
		this.metaDown = metaDown;
	}

	public setSender(sender: Sender): void {
		this.sender = sender;
	}

	@Mobx.action
	public setScrollPosition(scrollPosition: Types.Point): void {
		this.scrollPosition = scrollPosition;
	}

	@Mobx.action
	public setApp(app: Model.AlvaApp<Message.Message>): void {
		this.app = app;
	}
}
