"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.init = init;
exports.getInit = getInit;
let _config = null;
function init(config) {
    _config = config;
}
function getInit() {
    if (!_config) {
        throw new Error("Config not initialized. Call modInit(config) before using any class.");
    }
    return _config;
}
//# sourceMappingURL=config.js.map