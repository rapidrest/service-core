export class StatusExtraData {
    private _data: any = {};
    get data() {
        return this._data;
    }
    set data(data) {
        this._data = data;
    }
    constructor(other: Partial<StatusExtraData>) {
        if (other) {
            this._data = other.data || this._data;
        }
    }
}