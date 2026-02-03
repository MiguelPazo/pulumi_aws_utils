/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */
import * as aws from "@pulumi/aws";
import * as fs from 'fs';
import {InitConfig} from "../types/module";
import {UserProwlerConfig} from "../types";
import {getInit} from "../config";

export type UserProwlerResult = {
    group: aws.iam.Group;
    policy: aws.iam.Policy;
    groupPolicyAttachment: aws.iam.GroupPolicyAttachment;
    users: aws.iam.User[];
    userGroupMemberships: aws.iam.UserGroupMembership[];
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

    async main(config: UserProwlerConfig = {}): Promise<UserProwlerResult> {
        const {
            groupName = 'prowler',
            users = []
        } = config;

        const groupFullName = `${this.config.generalPrefixShort}-${groupName}-tool`;

        /**
         * Create IAM Group
         */
        const group = new aws.iam.Group(`${this.config.project}-${groupName}-group`, {
            name: groupFullName,
            path: "/"
        });

        /**
         * Create IAM Policy from prowler_policy.json
         */
        const policyDocument = fs.readFileSync(__dirname + '/../resources/iam/prowler_policy.json', 'utf8');

        const policy = new aws.iam.Policy(`${this.config.project}-${groupName}-policy`, {
            name: `${groupFullName}-policy`,
            description: "Prowler security audit policy - read-only access for security assessments",
            policy: policyDocument,
            tags: {
                ...this.config.generalTags,
                Name: `${groupFullName}-policy`,
            }
        });

        /**
         * Attach Policy to Group
         */
        const groupPolicyAttachment = new aws.iam.GroupPolicyAttachment(`${this.config.project}-${groupName}-policy-attachment`, {
            group: group.name,
            policyArn: policy.arn
        });

        /**
         * Create IAM Users and add them to the group
         */
        const iamUsers: aws.iam.User[] = [];
        const userGroupMemberships: aws.iam.UserGroupMembership[] = [];

        for (const userName of users) {
            const userFullName = `${this.config.generalPrefixShort}-${groupName}-${userName}`;

            // Create IAM User
            const user = new aws.iam.User(`${this.config.project}-${groupName}-${userName}-user`, {
                name: userFullName,
                tags: {
                    ...this.config.generalTags,
                    Name: userFullName,
                }
            });

            iamUsers.push(user);

            // Add user to group
            const membership = new aws.iam.UserGroupMembership(`${this.config.project}-${groupName}-${userName}-group-membership`, {
                user: user.name,
                groups: [group.name]
            });

            userGroupMemberships.push(membership);
        }

        return {
            group,
            policy,
            groupPolicyAttachment,
            users: iamUsers,
            userGroupMemberships
        };
    }
}

export {UserProwler}
