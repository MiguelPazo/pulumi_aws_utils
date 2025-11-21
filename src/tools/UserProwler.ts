/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as fs from 'fs';
import {InitConfig} from "../types/module";
import {getInit} from "../config";

export type UserProwlerResult = {
    user: aws.iam.User;
    policy: aws.iam.Policy;
    policyAttachment: aws.iam.UserPolicyAttachment;
};

class UserProwler {
    private static __instance: UserProwler;
    private config: InitConfig;

    constructor() {
        this.config = getInit();
    }

    public static getInstance(): UserProwler {
        if (this.__instance == null) {
            this.__instance = new UserProwler();
        }

        return this.__instance;
    }

    async main(
        userName: string
    ): Promise<UserProwlerResult> {
        const userFullName = `${this.config.generalPrefixShort}-${userName}-tool`;

        /**
         * Create IAM User
         */
        const user = new aws.iam.User(`${this.config.project}-${userName}-user`, {
            name: userFullName,
            tags: {
                ...this.config.generalTags,
                Name: userFullName,
            }
        });

        /**
         * Create IAM Policy from prowler_policy.json
         */
        const policyDocument = fs.readFileSync(__dirname + '/../resources/iam/prowler_policy.json', 'utf8');

        const policy = new aws.iam.Policy(`${this.config.project}-${userName}-policy`, {
            name: `${userFullName}-policy`,
            description: "Prowler security audit policy - read-only access for security assessments",
            policy: policyDocument,
            tags: {
                ...this.config.generalTags,
                Name: `${userFullName}-policy`,
            }
        });

        /**
         * Attach Policy to User
         */
        const policyAttachment = new aws.iam.UserPolicyAttachment(`${this.config.project}-${userName}-policy-attachment`, {
            user: user.name,
            policyArn: policy.arn
        });

        return {
            user,
            policy,
            policyAttachment
        };
    }
}

export {UserProwler}
