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
import {ElastiCache} from './src/modules/ElastiCache';
import {Rds} from './src/modules/Rds';
import {S3} from './src/modules/S3';
import {ApiGatewayVpcLink} from './src/modules/ApiGatewayVpcLink';
import {init} from './src/config';
import {LambdaRole} from "./src/modules/LambdaRole";
import {NlbListener} from "./src/modules/NlbListener";
import {Ses} from "./src/modules/Ses";
import {VpcImport} from "./src/modules/VpcImport";

export const AwsUtilsInit = {
    init
};

export const AwsUtilsCommon = {
    General,
    UtilsInfra
};

export const AwsUtilsModules = {
    Alb,
    AlbListener,
    ApiGateway,
    CloudFrontBackend,
    CloudFrontFrontend,
    Ecr,
    EcsCluster,
    EcsService,
    ElastiCache,
    LambdaRole,
    Rds,
    S3,
    ApiGatewayVpcLink,
    NlbListener,
    Ses,
    VpcImport
};

export * from './src/types';
