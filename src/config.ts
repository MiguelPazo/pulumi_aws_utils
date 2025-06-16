/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import {InitConfig} from "./types/module";

let _config: InitConfig = null;

export function init(config: InitConfig) {
    _config = config;
}

export function getInit(): InitConfig {
    if (!_config) {
        throw new Error("Config not initialized. Call modInit(config) before using any class.");
    }

    return _config;
}
