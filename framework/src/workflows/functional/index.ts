import { LLMClientConfig, Message } from "../../llm/index.js"

type WorkFlowState<T> = {
  messages: readonly Message[],
  workflowId: string,
  context: T
}

type WorkFlowInternalState<T> = {
  states: WorkFlowState<T>[],
  conditionalState: boolean[]
}

type CheckpointHandler<T> = (workFlowState: WorkFlowState<T>) => Promise<WorkFlowState<T>>
type ConditionalHandlerSync<T> = (workFlowState: WorkFlowState<T>) => boolean
type ConditionalHandler<T> = (workFlowState: WorkFlowState<T>) => Promise<boolean>


type AgenticCheckpointConfig = {
  systemPrompt: string,
  tools: string[],
  modeConfig: LLMClientConfig
}


type WorkFlowBuilder<T> = {
  createCheckpoint: (handler: CheckpointHandler<T>) => Promise<WorkFlowState<T>>,
  createAgenticCheckpoint: (agentConfig: AgenticCheckpointConfig) => Promise<WorkFlowState<T>>
  evaluateConditionSync:  (handler: ConditionalHandlerSync<T>) => boolean ,
  evaluateCondition: (handler: ConditionalHandler<T> ) => Promise<boolean>,
  saveflowInternalState: () => Promise<boolean>,
  patchState: (newState: WorkFlowState<T>) => Promise<void>
  appendState:  (newState: WorkFlowState<T>) => Promise<void>
}


async function fetchWorkflowInternalState<T>(_id: string): Promise<WorkFlowInternalState<T>>{
  
  await Promise.resolve();
  return {
    states: [] as WorkFlowState<T>[],
    conditionalState:[]
  } as WorkFlowInternalState<T>


}

async function getWorkflowBuilder<T>(initialState:  WorkFlowState<T>) : Promise<WorkFlowBuilder<T>> {

  const intialWorkflowInternalState = await fetchWorkflowInternalState(initialState.workflowId);
  const states = intialWorkflowInternalState.states;
  const conditionalState = intialWorkflowInternalState.conditionalState;
  let state = initialState;
  let counter = -1;
  let conditionCounter = -1;

  const createCheckpoint = async (handler: CheckpointHandler<T>) : Promise<WorkFlowState<T>> => {
    counter++;
    if(states.length > counter) {
      return states[counter]! as  WorkFlowState<T>;
    }

    const nextState = await handler(state);
    state = nextState;
    states.push(nextState);
    return nextState;
  }

  const evaluateConditionSync = (handler: ConditionalHandlerSync<T>) : boolean  => {
    conditionCounter++;
    if(conditionalState.length > conditionCounter) {
      return conditionalState[conditionCounter]!;
    }
    const result = handler(state);

    conditionalState.push(result);
    return result;
  }

  const evaluateCondition = async (handler: ConditionalHandler<T> ) : Promise<boolean>  => {
    conditionCounter++;
    if(conditionalState.length > conditionCounter) {
      return conditionalState[conditionCounter]!;
    }
    const result = await handler(state);

    conditionalState.push(result);
    return result;
  }

  const saveflowInternalState = async () : Promise<boolean> => {
    await Promise.resolve();
    return true;
  }

  const createAgenticCheckpoint = async (_agentConfig: AgenticCheckpointConfig) : Promise<WorkFlowState<T>> => {
    await Promise.resolve();
    return state
  }

  const appendState = async (newState: WorkFlowState<T>) : Promise<void> => {
    states.push(newState);
    await saveflowInternalState();
  }

  const patchState = async (patchState: WorkFlowState<T>) : Promise<void> => {
    if(states.length > 0) {
      states[states.length] = patchState;
      await saveflowInternalState();
    } 
  }



  return {
    createCheckpoint,
    evaluateConditionSync,
    evaluateCondition,
    createAgenticCheckpoint,
    saveflowInternalState,
    patchState,
    appendState
  }

}


export default getWorkflowBuilder;


