/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as fs from "fs";
import * as path from "path";
import {getInit} from "../config";
import {InitConfig} from "../types/module";
import {General} from "../common/General";
import type {ParamStoreModuleConfig, SsmParamConfig} from "../types";

class ParamStore {
    private static __instance: ParamStore;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): ParamStore {
        if (this.__instance == null) {
            this.__instance = new ParamStore();
        }

        return this.__instance;
    }

    async main(moduleConfig: ParamStoreModuleConfig): Promise<void> {
        const {paramsPath, kmsKey} = moduleConfig;

        // Process _general directory
        await this.processDirectory(
            path.join(paramsPath, '_general'),
            '_general',
            kmsKey
        );

        // Process stack-specific directory
        await this.processDirectory(
            path.join(paramsPath, this.config.stack),
            this.config.stack,
            kmsKey
        );
    }

    private async processDirectory(
        dirPath: string,
        dirName: string,
        kmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>
    ): Promise<void> {
        if (!fs.existsSync(dirPath)) {
            console.log(`ParamStore: Directory '${dirName}' not found at path: ${dirPath}`);
            return;
        }

        const files = fs.readdirSync(dirPath).filter(file => file.endsWith('.json'));

        if (files.length === 0) {
            console.log(`ParamStore: No JSON files found in directory '${dirName}'`);
            return;
        }

        console.log(`ParamStore: Processing directory '${dirName}' with ${files.length} file(s)`);

        for (const file of files) {
            const filePath = path.join(dirPath, file);
            await this.processJsonFile(filePath, file, dirName, dirPath, kmsKey);
        }
    }

    private async processJsonFile(
        filePath: string,
        fileName: string,
        dirName: string,
        dirPath: string,
        kmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>
    ): Promise<void> {
        try {
            // Get accountId for replacements
            const accountId = await this.config.accountId;

            // Read file and apply standard replacements using General.renderText
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const renderedContent = General.renderText(fileContent, accountId);

            const params: SsmParamConfig[] = JSON.parse(renderedContent);

            if (!Array.isArray(params)) {
                console.warn(`ParamStore: File '${fileName}' in directory '${dirName}' does not contain an array of parameters`);
                return;
            }

            console.log(`ParamStore: Creating ${params.length} parameter(s) from '${fileName}' in directory '${dirName}'`);

            for (const param of params) {
                // Process value if it's a file reference [[filename.json]]
                const processedParam = this.processParamValue(param, dirPath, accountId);
                this.createSsmParameter(processedParam, dirName, kmsKey);
            }
        } catch (error) {
            console.error(`ParamStore: Error parsing JSON file '${fileName}' in directory '${dirName}':`, error);
        }
    }

    /**
     * Process parameter value to check if it's a file reference [[filename.json]]
     * If it is, read the file from dirPath/values/ and convert to JSON string
     */
    private processParamValue(
        param: SsmParamConfig,
        dirPath: string,
        accountId: string
    ): SsmParamConfig {
        const value = param.value;

        // Check if value starts with [[ and ends with ]]
        if (value.startsWith('[[') && value.endsWith(']]')) {
            // Extract filename from [[filename.json]]
            const filename = value.substring(2, value.length - 2);

            // Build path to values directory within the current directory
            const valuesPath = path.join(dirPath, 'values', filename);

            try {
                // Check if file exists
                if (!fs.existsSync(valuesPath)) {
                    console.error(`ParamStore: Referenced file not found: ${valuesPath}`);
                    throw new Error(`File not found: ${valuesPath}`);
                }

                // Read file content
                const fileContent = fs.readFileSync(valuesPath, 'utf8');

                // Apply standard replacements using General.renderText
                const renderedContent = General.renderText(fileContent, accountId);

                // Parse JSON to validate it
                const jsonContent = JSON.parse(renderedContent);

                // Convert back to string (minified JSON)
                const jsonString = JSON.stringify(jsonContent);

                console.log(`ParamStore: Loaded JSON content from '${filename}' for parameter '${param.name}'`);

                // Return new param object with processed value
                return {
                    ...param,
                    value: jsonString
                };
            } catch (error) {
                console.error(`ParamStore: Error processing file reference '${filename}' for parameter '${param.name}':`, error);
                throw error;
            }
        }

        // Return original param if no file reference
        return param;
    }

    private createSsmParameter(
        param: SsmParamConfig,
        dirName: string,
        kmsKey?: pulumi.Input<aws.kms.Key | aws.kms.ReplicaKey>
    ): void {
        const prefixFormatted = this.config.generalPrefix.replace(/-/g, '/');
        const paramName = `/${prefixFormatted}${param.name}`;

        const resourceOptions: pulumi.ResourceOptions = {};

        if (param.ignoreChanges === true) {
            resourceOptions.ignoreChanges = ["value"];
        }

        const paramOptions: aws.ssm.ParameterArgs = {
            name: paramName,
            type: param.type,
            value: param.value,
            description: param.description || `Parameter ${param.name}`,
            tags: {
                ...this.config.generalTags,
                Name: paramName,
                Source: dirName,
            }
        };

        // Add KMS key if provided and parameter type is SecureString
        if (kmsKey && param.type === "SecureString") {
            paramOptions.keyId = pulumi.output(kmsKey).apply(key => key.keyId);
        }

        const resourceName = `${this.config.project}-ssm-param-${dirName}-${param.name.replace(/\//g, '-')}`;

        new aws.ssm.Parameter(resourceName, paramOptions, resourceOptions);
    }
}

export {ParamStore}
