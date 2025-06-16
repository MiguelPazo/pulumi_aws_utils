"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LambdaRole = void 0;
/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
const aws = require("@pulumi/aws");
const pulumi = require("@pulumi/pulumi");
const fs = require("fs");
const config_1 = require("../config");
class LambdaRole {
    constructor() {
        this.config = (0, config_1.getInit)();
    }
    static getInstance() {
        if (this.__instance == null) {
            this.__instance = new LambdaRole();
        }
        return this.__instance;
    }
    async main(lambda, policyFilePath, policy) {
        /**
         * Policy
         */
        const policyJson = policy || pulumi.all([this.config.accountId]).apply(data => {
            let policyStr = fs.readFileSync(policyFilePath, 'utf8')
                .replace(/rep_region/g, aws.config.region)
                .replace(/rep_accountid/g, data[0])
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
            assumeRolePolicy: {
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Principal: {
                            Service: "lambda.amazonaws.com"
                        },
                        Action: "sts:AssumeRole"
                    }
                ]
            },
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
exports.LambdaRole = LambdaRole;
//# sourceMappingURL=LambdaRole.js.map