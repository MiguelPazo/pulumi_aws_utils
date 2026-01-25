/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as fs from 'fs';
import {LambdaConfig} from "../types";
import {InitConfig} from "../types/module";
import {getInit} from "../config";

class LambdaRole {
    private static __instance: LambdaRole;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): LambdaRole {
        if (this.__instance == null) {
            this.__instance = new LambdaRole();
        }

        return this.__instance;
    }

    async main(
        lambda: LambdaConfig,
        policyFilePath?: string,
        policy?: pulumi.Output<string>,
        isEdge?: boolean
    ): Promise<aws.iam.Role> {
        /**
         * Policy
         */
        const policyJson = policy || pulumi.all([this.config.accountId]).apply(data => {
            let policyStr = fs.readFileSync(policyFilePath, 'utf8')
                .replace(/rep_region/g, aws.config.region)
                .replace(/rep_accountid/g, data[0])
                .replace(/rep_stack_alias/g, this.config.stackAlias)
                .replace(/rep_stack/g, this.config.stack)
                .replace(/rep_project/g, this.config.project)
                .replace(/rep_log_grup/g, `${this.config.generalPrefix}-${lambda.name}`);

            return Promise.resolve(JSON.parse(policyStr));
        });

        const lambdaPolicy = new aws.iam.Policy(`${this.config.project}-${lambda.name}-lambda-policy`, {
            name: `${this.config.generalPrefixShort}-${lambda.name}-lambda-policy`,
            path: "/",
            description: `Policy for lambda ${this.config.generalPrefix}-${lambda.name}`,
            policy: policyJson,
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-${lambda.name}-lambda-policy`,
            }
        });

        /**
         * Role
         */
        const lambdaRole = new aws.iam.Role(`${this.config.project}-${lambda.name}-lambda-role`, {
            name: `${this.config.generalPrefixShort}-${lambda.name}-lambda-role`,
            assumeRolePolicy: pulumi.all([this.config.accountId]).apply(([accountId]) => {
                const region = isEdge ? "us-east-1" : aws.config.region;

                return JSON.stringify({
                    Version: "2012-10-17",
                    Statement: [
                        {
                            Effect: "Allow",
                            Principal: {
                                Service: isEdge ? ["edgelambda.amazonaws.com", "lambda.amazonaws.com"] : "lambda.amazonaws.com"
                            },
                            Action: "sts:AssumeRole",
                            Condition: {
                                StringEquals: {
                                    "aws:SourceAccount": accountId
                                }
                            }
                        }
                    ]
                });
            }),
            tags: {
                ...this.config.generalTags,
                Name: `${this.config.generalPrefixShort}-${lambda.name}-lambda-role`,
            }
        });

        new aws.iam.RolePolicyAttachment(`${this.config.project}-${lambda.name}-lambda-role-attach1`, {
            role: lambdaRole.name,
            policyArn: lambdaPolicy.arn,
        });

        return lambdaRole;
    }
}

export {LambdaRole}
