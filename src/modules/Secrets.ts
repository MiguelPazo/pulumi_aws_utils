/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {InitConfig} from "../types/module";
import {SecretsConfig} from "../types";
import {getInit} from "../config";

class Secrets {
    private static __instance: Secrets;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): Secrets {
        if (this.__instance == null) {
            this.__instance = new Secrets();
        }

        return this.__instance;
    }

    async main(config: SecretsConfig): Promise<aws.secretsmanager.Secret> {
        const {
            name,
            kmsKey,
            secretString = {delete: "me"},
            description,
            recoveryWindowInDays = 30,
            forceOverwriteReplicaSecret = true,
            kmsKeyReplica,
            tags
        } = config;

        const multiRegion = this.config.multiRegion || false;
        const failoverReplica = this.config.failoverReplica || false;
        const regionReplica = this.config.regionReplica;

        const secretName = `${this.config.generalPrefix}-${name}`;

        /**
         * Handle failover replica scenario - get existing secret
         */
        if (failoverReplica) {
            if (!regionReplica) {
                throw new Error("regionReplica is required when failoverReplica is true");
            }

            return aws.secretsmanager.Secret.get(
                `${this.config.project}-${name}-secret-failover`,
                secretName
            );
        }

        /**
         * Validate multi-region requirements
         */
        if (multiRegion) {
            if (!regionReplica) {
                throw new Error("regionReplica is required when multiRegion is true");
            }
            if (!kmsKeyReplica) {
                throw new Error("kmsKeyReplica is required when multiRegion is true");
            }
        }

        /**
         * Create primary secret with optional replicas
         */
        const secret = new aws.secretsmanager.Secret(`${this.config.project}-${name}-secret`, {
            name: secretName,
            description: description,
            kmsKeyId: kmsKey?.keyId,
            recoveryWindowInDays: recoveryWindowInDays,
            forceOverwriteReplicaSecret: forceOverwriteReplicaSecret,
            // Configure replicas for multi-region if enabled
            ...(multiRegion && regionReplica && {
                replicas: [{
                    region: regionReplica,
                    kmsKeyId: kmsKeyReplica?.keyId
                }]
            }),
            tags: {
                ...this.config.generalTags,
                Name: secretName,
                ...tags
            }
        });

        /**
         * Create secret version with secretString
         */
        new aws.secretsmanager.SecretVersion(`${this.config.project}-${name}-secret-version`, {
            secretId: secret.id,
            secretString: JSON.stringify(secretString)
        }, {
            ignoreChanges: ["secretString", "versionStages"]
        });

        return secret;
    }
}

export {Secrets}
