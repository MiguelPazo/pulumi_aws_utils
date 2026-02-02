/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as archiver from "archiver";
import * as fs from "fs";
import {getInit} from "../config";

class General {
    static zipDirectory(sourceDir, outPath): Promise<any> {
        const archive = archiver("zip", {zlib: {level: 9}});
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

    static getValue<T>(output: pulumi.Output<T>): Promise<any> {
        return new Promise<T>((resolve, reject) => {
            output.apply(value => {
                resolve(value);
            });
        });
    }

    static getJsonInArray(data, key, val): any {
        for (let i in data) {
            if (data[i][key] === val) {
                return data[i];
            }
        }

        return null;
    }

    /**
     * Apply standard replacements to a text string
     * @param text - The text content to process
     * @param accountId - AWS account ID
     * @returns Processed text with replacements applied
     */
    static renderText(text: string, accountId: string): string {
        const config = getInit();

        return text
            .replace(/rep_region/g, config.region)
            .replace(/rep_accountid/g, accountId)
            .replace(/rep_general_prefix_multiregion/g, config.generalPrefixMultiregion || config.generalPrefix)
            .replace(/rep_general_prefix/g, config.generalPrefix)
            .replace(/rep_stack_alias/g, config.stackAlias || config.stack)
            .replace(/rep_project/g, config.project)
            .replace(/rep_stack/g, config.stack);
    }

    static renderPolicy(filePolicy: string): pulumi.Output<any> {
        const config = getInit();

        return pulumi.all([config.accountId]).apply(([accountId]) => {
            const fileContent = fs.readFileSync(filePolicy, 'utf8');
            const renderedContent = General.renderText(fileContent, accountId);

            return Promise.resolve(JSON.parse(renderedContent));
        });
    }
}

export {General}
