/** 复刻：技能库数据类型（对应原型 src/data/skills.js 结构，数据文件为 @ts-nocheck 转置，此处补齐类型） */

export interface SkillScenario {
	title: string;
	desc: string;
	icon: string;
}

export interface SkillCapability {
	title: string;
	desc: string;
}

export interface SkillTool {
	id: string;
	name: string;
	description: string;
}

export interface SkillOutput {
	id: string;
	name: string;
	desc: string;
	preview: string;
}

export interface SkillSampleTask {
	title: string;
	description: string;
	preparedMaterials: string[];
}

export interface Skill {
	id: string;
	name: string;
	icon: string;
	scope: string;
	category: string;
	description: string;
	scenarios: SkillScenario[];
	capabilities: SkillCapability[];
	requiredMaterials: string[];
	recommendedMaterials: string[];
	tools: SkillTool[];
	toolEmptyText: string;
	outputs: SkillOutput[];
	sampleTask: SkillSampleTask;
	relatedSkills: string[];
	useMode: string;
}
