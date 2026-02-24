/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import {getInit} from "../config";
import {InitConfig} from "../types/module";
import type {SSMAssociationsModuleConfig, SSMAssociationsResult} from "../types";

class SSMAssociations {
    private static __instance: SSMAssociations;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): SSMAssociations {
        if (this.__instance == null) {
            this.__instance = new SSMAssociations();
        }

        return this.__instance;
    }

    async main(config: SSMAssociationsModuleConfig): Promise<SSMAssociationsResult> {
        const {
            schedule = "cron(0 6 ? * SUN *)",
            operatingSystem = "AMAZON_LINUX_2023",
            patchClassification = ["Security"],
            rebootOption = "RebootIfNeeded",
            tagKey = "patch",
            tagValue = "true"
        } = config;

        /**
         * Patch Baseline
         */
        const patchBaseline = new aws.ssm.PatchBaseline(`${this.config.project}-ssm-patch-baseline`, {
            name: `${this.config.generalPrefix}-ssm-patch-baseline`,
            operatingSystem: operatingSystem,
            approvedPatchesComplianceLevel: "CRITICAL",
            approvalRules: [
                {
                    approveAfterDays: 0,
                    complianceLevel: "CRITICAL",
                    patchFilters: [
                        {
                            key: "CLASSIFICATION",
                            values: patchClassification,
                        },
                    ],
                },
            ],
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-ssm-patch-baseline`,
            },
        });

        /**
         * Patch Group
         */
        const patchGroupName = `${this.config.generalPrefix}-ssm-patch-group`;

        const patchGroup = new aws.ssm.PatchGroup(`${this.config.project}-ssm-patch-group`, {
            baselineId: patchBaseline.id,
            patchGroup: patchGroupName,
        });

        /**
         * SSM Association
         */
        const association = new aws.ssm.Association(`${this.config.project}-ssm-patch-association`, {
            name: "AWS-RunPatchBaseline",
            associationName: `${this.config.generalPrefix}-ssm-patch-association`,
            scheduleExpression: schedule,
            targets: [
                {
                    key: `tag:${tagKey}`,
                    values: [tagValue],
                },
            ],
            parameters: {
                Operation: "Install",
                RebootOption: rebootOption,
            },
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefix}-ssm-patch-association`,
            },
        });

        return {
            patchBaseline,
            patchGroup,
            association,
        };
    }
}

export {SSMAssociations}
