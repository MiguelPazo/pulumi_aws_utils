/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import {InitConfig} from "../types/module";
import type {KmsKeyConfig, KmsKeyResult} from "../types";
import {getInit} from "../config";

class Kms {
    private static __instance: Kms;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Kms {
        if (this.__instance == null) {
            this.__instance = new Kms();
        }

        return this.__instance;
    }

    async main(
        name: string,
        keyConfig?: KmsKeyConfig,
        createAlias: boolean = true,
        additionalStatements?: any[],
        provider?: aws.Provider
    ): Promise<KmsKeyResult> {
        const keyName = `${this.config.project}-${name}-kms-key`;
        const keyDescription = keyConfig?.description || `KMS key for ${name}`;

        const key = new aws.kms.Key(keyName, {
            description: keyDescription,
            keyUsage: keyConfig?.keyUsage || "ENCRYPT_DECRYPT",
            customerMasterKeySpec: keyConfig?.keySpec || "SYMMETRIC_DEFAULT",
            multiRegion: keyConfig?.multiRegion || false,
            deletionWindowInDays: keyConfig?.deletionWindowInDays || 7,
            enableKeyRotation: keyConfig?.enableKeyRotation || true,
            policy: keyConfig?.policy || pulumi.output(this.config.accountId).apply(x => {
                const baseStatements = [
                    {
                        Sid: "EnableRootPermissions",
                        Effect: "Allow",
                        Principal: {
                            AWS: `arn:aws:iam::${x}:root`,
                        },
                        Action: "kms:*",
                        Resource: "*",
                    }
                ];

                if (additionalStatements) {
                    baseStatements.push(...additionalStatements);
                }

                return JSON.stringify({
                    Version: "2012-10-17",
                    Statement: baseStatements
                })
            }),
            tags: {
                ...this.config.generalTags,
                Name: keyName,
                ...keyConfig?.tags
            }
        }, provider ? { provider } : undefined);

        let alias: aws.kms.Alias | undefined;

        if (createAlias) {
            alias = new aws.kms.Alias(`${this.config.project}-${name}-kms-alias`, {
                name: `alias/${this.config.generalPrefix}-${name}-kms`,
                targetKeyId: key.keyId,
            }, provider ? { provider } : undefined);
        }

        return {
            key,
            alias
        } as KmsKeyResult
    }

    async updateKeyPolicy(
        keyId: string | pulumi.Output<string>,
        policyName: string,
        newPolicy: string | pulumi.Output<string>
    ): Promise<aws.kms.KeyPolicy> {
        return new aws.kms.KeyPolicy(`${this.config.project}-kms-policy-${policyName}`, {
            keyId: keyId,
            policy: newPolicy
        });
    }
}

export {Kms}