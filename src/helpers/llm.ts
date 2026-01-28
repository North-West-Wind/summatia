import { pipeline, PipelineType, TextClassificationPipeline, TextGenerationPipeline } from "@huggingface/transformers";

type Pipeline = TextClassificationPipeline | TextGenerationPipeline;

export default class LLMPipeline {
	static pipelines: Map<string, Pipeline> = new Map();

	static async getInstance(task: PipelineType, model: string) {
		const key = task + ":" + model;
		if (this.pipelines.has(key)) return this.pipelines.get(key)!;
		const pl = (await pipeline(task, model, { dtype: "q4" }) as any) as Pipeline;
		this.pipelines.set(key, pl);
		return pl;
	}
}