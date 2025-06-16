"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.General = void 0;
const archiver = require("archiver");
const fs = require("fs");
class General {
    static zipDirectory(sourceDir, outPath) {
        const archive = archiver("zip", { zlib: { level: 9 } });
        const stream = fs.createWriteStream(outPath);
        return new Promise((resolve, reject) => {
            archive
                .directory(sourceDir, false)
                .on("error", err => reject(err))
                .pipe(stream);
            stream.on("close", () => resolve({}));
            archive.finalize();
        });
    }
    static getValue(output) {
        return new Promise((resolve, reject) => {
            output.apply(value => {
                resolve(value);
            });
        });
    }
    static getJsonInArray(data, key, val) {
        for (let i in data) {
            if (data[i][key] === val) {
                return data[i];
            }
        }
        return null;
    }
}
exports.General = General;
//# sourceMappingURL=General.js.map