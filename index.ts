/**
 * Created by Miguel Pazo (https://miguelpazo.com)
 */

/**
 * Utils
 */
import {General} from './src/common/General';
import {UtilsInfra} from './src/common/UtilsInfra';

/**
 * Modules
 */
import {Alb} from './src/modules/Alb';
import {AlbListener} from './src/modules/AlbListener';
import {ApiGateway} from './src/modules/ApiGateway';
import {CloudFrontBackend} from './src/modules/CloudFrontBackend';
import {CloudFrontFrontend} from './src/modules/CloudFrontFrontend';
import {Ecr} from './src/modules/Ecr';
import {EcsCluster} from './src/modules/EcsCluster';
import {EcsService} from './src/modules/EcsService';
import {Efs} from './src/modules/Efs';
import {ElastiCache} from './src/modules/ElastiCache';
import {Rds} from './src/modules/Rds';
import {RdsAurora} from './src/modules/RdsAurora';
import {RdsProxy} from './src/modules/RdsProxy';
import {S3} from './src/modules/S3';
import {Sqs} from './src/modules/Sqs';
import {ApiGatewayVpcLink} from './src/modules/ApiGatewayVpcLink';
import {init} from './src/config';
import {LambdaRole} from "./src/modules/LambdaRole";
import {NlbListener} from "./src/modules/NlbListener";
import {Ses} from "./src/modules/Ses";
import {VpcImport} from "./src/modules/VpcImport";
import {Ssm} from "./src/modules/Ssm";
import {Kms} from "./src/modules/Kms";
import {DynamoDb} from "./src/modules/DynamoDb";
import {LambdaRestart} from "./src/tools/LambdaRestart";

export const AwsUtilsInit = {
    init
};

export const AwsUtilsCommon = {
    General,
    UtilsInfra
};

export const AwsUtilsTools = {
    LambdaRestart,
};

export const AwsUtilsModules = {
    Alb,
    AlbListener,
    ApiGateway,
    CloudFrontBackend,
    CloudFrontFrontend,
    DynamoDb,
    Ecr,
    EcsCluster,
    EcsService,
    Efs,
    ElastiCache,
    Kms,
    LambdaRole,
    Rds,
    RdsAurora,
    RdsProxy,
    S3,
    Sqs,
    Ssm,
    ApiGatewayVpcLink,
    NlbListener,
    Ses,
    VpcImport
};

export * from './src/types';
export * from './src/common/Enums';
