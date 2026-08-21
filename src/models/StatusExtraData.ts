///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
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
            this._data = "data" in other ? other.data : this._data;
        }
    }
}
