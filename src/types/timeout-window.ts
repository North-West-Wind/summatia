export default class TimeoutWindow<T, D> {
	private _initialValue: T;
	private _value: T;
	private _duration: number;
	private timeout?: ReturnType<typeof setTimeout>;
	data?: D;

	constructor(initialValue: T, duration: number) {
		this._value = this._initialValue = initialValue;
		this._duration = duration;
	}

	get value() {
		return this._value;
	}

	set value(newValue: T) {
		if (this.timeout) clearTimeout(this.timeout);
		this._value = newValue;
		this.timeout = setTimeout(() => {
			this._value = this._initialValue;
			this.data = undefined;
		}, this._duration);
	}

	refresh() {
		if (this.timeout) clearTimeout(this.timeout);
		this.timeout = setTimeout(() => {
			this._value = this._initialValue;
			this.data = undefined;
		}, this._duration);
	}
}