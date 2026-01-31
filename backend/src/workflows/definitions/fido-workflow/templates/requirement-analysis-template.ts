export const createRequirementAnalysisTemplate = (workflowDescription?: string) => {

  const finalDescription = 
    `I want to generate requirement analysis in this XML format and SAVE IT TO A FILE. 

    **IMPORTANT: After generating your comprehensive requirement analysis, save it to the file: \`generated-requirement-analysis.xml\`**
  generate requirememt in XML format for the following feature in very detail:
${workflowDescription}
**keep that in mind to do not create mutiple binaries in the project (since cargo run is getting confused)
**project should compile and run without errors.
**database and schema should be consistent with the requirement analysis
**there should be no todos or mock implementations in the code since this is production ready code
**add a step that execute in the last which marks \`generated-requirement-analysis.xml\` as \`generated-requirement-analysis.xml.resolved\` once all the tasks of the requirement analysis are completed
` ;

return finalDescription;
};

// Keep backward compatibility with the original static template
export const REQUIREMENT_ANALYSIS_TEMPLATE = createRequirementAnalysisTemplate();
