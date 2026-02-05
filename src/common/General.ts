/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as archiver from "archiver";
import * as fs from "fs";
import * as Handlebars from "handlebars";
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

    static renderTemplate(filePolicy: string, additionalContext?: any, convertToJson: boolean = true): pulumi.Output<any> {
        const config = getInit();

        return pulumi.all([config.accountId]).apply(([accountId]) => {
            const fileContent = fs.readFileSync(filePolicy, 'utf8');

            // Compile Handlebars template
            const template = Handlebars.compile(fileContent, {
                strict: false,
                noEscape: true
            });

            // Prepare template context
            const context = {
                region: config.region,
                regionReplica: config.regionReplica || config.region,
                regionPrimary: config.regionPrimary || config.region,
                accountId: accountId,
                generalPrefix: config.generalPrefix,
                generalPrefixMultiregion: config.generalPrefixMultiregion || config.generalPrefix,
                stackAlias: config.stackAlias || config.stack,
                project: config.project,
                stack: config.stack,
                multiRegion: config.multiRegion || false,
                failoverReplica: config.failoverReplica || false,
                ...additionalContext
            };

            // Render template
            const renderedContent = template(context);

            // Convert to JSON if requested (default behavior)
            if (convertToJson) {
                try {
                    const policy = JSON.parse(renderedContent);
                    return Promise.resolve(policy);
                } catch (error) {
                    console.error(`Error parsing JSON from rendered template: ${filePolicy}`);
                    console.error('Rendered content:', renderedContent);
                    throw new Error(`Failed to parse JSON from template ${filePolicy}: ${error.message}`);
                }
            }

            // Return rendered content as string
            return Promise.resolve(renderedContent);
        });
    }
}

export {General}
