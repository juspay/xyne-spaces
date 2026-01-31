// run-fido-fixed.cjs - FIDO Automation with mocha-report content extraction
const { _electron: electron } = require('playwright');

async function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

// Function to run automation and return structured results
async function runFidoAutomation(appPath, testType) {
  const results = {
    success: false,
    testResults: {
      passed: 0,
      failed: 0,
      total: 0
    },
    output: ''
  };

  function log(message) {
    console.error(message);  // Send logs to stderr instead of stdout
    process.stderr.write(''); // Force flush stderr
  }

  if (!appPath) {
    const error = 'Usage: node run-fido-fixed.cjs <path-to-app-binary>';
    throw new Error(error);
  }
  
  log('🚀 Starting FIDO Alliance Automation with mocha-report extraction');
  log(`App path: ${appPath} | Test Type: ${testType}`);

  const app = await electron.launch({
    executablePath: appPath,
    args: ['--remote-debugging-port=9222'],
    // slowMo: 100 // uncomment for debugging
  });

  try {
    log('✅ FIDO app opened successfully');
    const win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    log(`Title: ${await win.title()}`);

    // Wait for main UI to settle
    await win.waitForTimeout(3000);
    
    // Element classes provided by user (using class selectors)
    const checkboxClass = "fido__testlist__item.fido__testcase__option.mdl-checkbox__input";
    const inputFieldClass = "fido__config__option.mdl-textfield__input";
    const runButtonClass = "fido__test__mocha--start.mdl-button.mdl-js-button.mdl-button--raised.mdl-js-ripple-effect.mdl-button--colored.mdl-color-text--white";
    const resultsDivId = "mocha-report";

    log('\n1️⃣ Selecting checkboxes...');
    let checkboxSuccess = 0;
    
    try {
      // Find all checkboxes with the specified classes
      const checkboxes = win.locator(`.${checkboxClass.replace(/\s+/g, '.')}`);
      const count = await checkboxes.count();
      log(`Found ${count} checkboxes`);
      
      if (count > 0) {
        let checkboxselectstart = 0;
        let checkboxtoselectend = 5; // Default range

        if (testType === 'ATTESTATION') {
          checkboxselectstart = 0;
          checkboxtoselectend = 2;
          log('ATTESTATION test range selected: checkboxes 1 to 2');
        } else if (testType === 'ASSERTION') {
          checkboxselectstart = 3;
          checkboxtoselectend = 5;
          log('ASSERTION test range selected: checkboxes 4 to 5');
        } else {
          log(`No specific testType ('${testType}'), selecting default range: checkboxes 1 to 5`);
        }

        log(`📋 Configuring all ${count} checkboxes...`);
        for (let i = 0; i < count; i++) {
          const checkbox = checkboxes.nth(i);
          const isChecked = await checkbox.isChecked();
          const shouldBeChecked = i >= checkboxselectstart && i < checkboxtoselectend;

          try {
            if (shouldBeChecked && !isChecked) {
              await checkbox.check();
              log(`✅ Enabled checkbox ${i + 1}`);
              checkboxSuccess++;
            } else if (!shouldBeChecked && isChecked) {
              await checkbox.uncheck();
              log(`Disabled checkbox ${i + 1}`);
            } else if (shouldBeChecked && isChecked) {
              log(`✅ Checkbox ${i + 1} already enabled`);
              checkboxSuccess++;
            } else {
              // log(`➖ Checkbox ${i + 1} already disabled`);
            }
          } catch (e) {
            log(`❌ Error configuring checkbox ${i + 1}: ${e.message}`);
          }
        }
      } else {
        // Try alternative checkbox selectors
        log('🔄 Trying alternative checkbox selectors...');
        const altSelectors = [
          'input[type="checkbox"]',
          '.mdl-checkbox__input',
          '.fido__testcase__option',
          '[class*="checkbox"]'
        ];
        
        for (const selector of altSelectors) {
          try {
            const altCheckboxes = win.locator(selector);
            const altCount = await altCheckboxes.count();
            if (altCount > 0) {
              log(`Found ${altCount} checkboxes using selector: ${selector}`);
              // Select only first 5 checkboxes out of total
              const checkboxesToSelect = Math.min(altCount, 5);
              log(`📋 Selecting first ${checkboxesToSelect} out of ${altCount} checkboxes`);
              
              for (let i = 0; i < checkboxesToSelect; i++) {
                const checkbox = altCheckboxes.nth(i);
                const isChecked = await checkbox.isChecked();
                if (!isChecked) {
                  await checkbox.check();
                  log(`✅ Checkbox ${i + 1} selected (alt method)`);
                  checkboxSuccess++;
                } else {
                  log(`✅ Checkbox ${i + 1} already selected (alt method)`);
                  checkboxSuccess++;
                }
                await sleep(300);
              }
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
      }
    } catch (e) {
      log(`❌ Error finding checkboxes: ${e.message}`);
    }
    
    log(`📊 Selected ${checkboxSuccess} checkboxes`);

    log('\n2️⃣ Inputting localhost:8080...');
    try {
      // Use class selector for input field
      const inputField = win.locator(`.${inputFieldClass.replace(/\s+/g, '.')}`);
      const count = await inputField.count();
      
      if (count > 0) {
        await inputField.first().clear();
        await inputField.first().fill('http://localhost:8080');
        log('✅ Text input successful: localhost:8080');
      } else {
        // Try alternative input selectors
        log('🔄 Trying alternative input selectors...');
        const altInputSelectors = [
          '.mdl-textfield__input',
          '.fido__config__option',
          'input[type="text"]',
          'input[type="url"]',
          '[class*="textfield"]'
        ];
        
        for (const selector of altInputSelectors) {
          try {
            const altInput = win.locator(selector);
            const altCount = await altInput.count();
            if (altCount > 0) {
              await altInput.first().clear();
              await altInput.first().fill('localhost:8080');
              log(`✅ Text input successful using selector: ${selector}`);
              break;
            }
          } catch (e) {
            // Continue to next selector
          }
        }
      }
    } catch (e) {
      log(`❌ Error inputting text: ${e.message}`);
    }

    log('\n3️⃣ Clicking run button...');
    try {
      // The error showed this is an <a> element, not a button, so try different approach
      const button = win.locator('a.fido__test__mocha--start');
      const count = await button.count();
      
      if (count > 0) {
        // Try force click for <a> elements that might have event handlers
        await button.first().click({ force: true });
        log(`✅ Button clicked with force: fido__test__mocha--start`);
      } else {
        log(`❌ Button not found with simplified selector`);
        // Try alternative approaches for the button
        log('🔄 Trying alternative button approaches...');
        
        const alternatives = [
          { selector: 'a[class*="fido__test__mocha--start"]', method: 'force' },
          { selector: 'a[class*="mdl-button"]', method: 'force' },
          { selector: '[class*="mocha--start"]', method: 'force' },
          { selector: 'button:has-text("Run")', method: 'normal' },
          { selector: 'a:has-text("Run")', method: 'force' },
          { selector: '[role="button"]', method: 'normal' }
        ];
        
        for (const alt of alternatives) {
          try {
            const altButton = win.locator(alt.selector);
            const altCount = await altButton.count();
            if (altCount > 0) {
              if (alt.method === 'force') {
                await altButton.first().click({ force: true });
              } else {
                await altButton.first().click();
              }
              log(`✅ Button clicked using selector: ${alt.selector} (${alt.method})`);
              break;
            }
          } catch (e) {
            log(`⚠️ Failed with selector ${alt.selector}: ${e.message}`);
            // Continue to next selector
          }
        }
      }
    } catch (e) {
      log(`❌ Error clicking button: ${e.message}`);
      // Don't fail the entire script, continue to wait for results anyway
    }

    log('\n4️⃣ Waiting for test results to complete...');
    
    // Wait for tests to actually start and complete
    // First wait 10 seconds for tests to start
    await sleep(10000);
    log('✅ 10 second initial wait completed');
    
    // Now wait for tests to complete by checking for completion indicators
    let waitTime = 0;
    const maxWaitTime = 180000; // 3 minutes max
    const checkInterval = 5000; // Check every 5 seconds
    
    log('🔍 Monitoring test completion...');
    while (waitTime < maxWaitTime) {
      try {
        // Check if tests are complete by looking for completion indicators
        const resultsDiv = win.locator('#mocha-report');
        const content = await resultsDiv.textContent();
        
        if (content && content.length > 1000) {
          // Check for test completion indicators
          const hasPassFailCounts = content.includes('passes') || content.includes('failures');
          const hasTestResults = /\d+\s*(passing|failing|tests?)/i.test(content);
          
          if (hasPassFailCounts || hasTestResults) {
            log(`✅ Tests appear complete after ${(waitTime + 10000)/1000}s (content length: ${content.length})`);
            break;
          }
        }
        
        log(`⏳ Still waiting... ${(waitTime + 10000)/1000}s elapsed (content length: ${content?.length || 0})`);
        await sleep(checkInterval);
        waitTime += checkInterval;
        
      } catch (e) {
        // Continue waiting if there's an error checking
        await sleep(checkInterval);
        waitTime += checkInterval;
      }
    }
    
    if (waitTime >= maxWaitTime) {
      log(`⚠️ Maximum wait time reached (${(maxWaitTime + 10000)/1000}s), proceeding with extraction`);
    }
    
    // Extract results from mocha-report div and test count elements
    try {
      // Use ID selector for results div (mocha-report)
      const resultsDiv = win.locator(`#${resultsDivId}`);
      const count = await resultsDiv.count();

      if (count > 0) {
        log('✅ mocha-report div found');

        // Extract suites with failed tests
        try {
          log('🔍 Extracting suites that contain failed tests...');

          // Find all suites (li with class "suite") within mocha-report
          const suiteElements = resultsDiv.locator('li.suite');
          const suiteCount = await suiteElements.count();
          log(`Found ${suiteCount} suite elements`);

          const failedSuitesContent = [];
          let totalPasses = 0;
          let totalFailures = 0;

          for (let i = 0; i < suiteCount; i++) {
            const suite = suiteElements.nth(i);

            try {
              // Check if this suite contains any failed tests
              const failedTestElements = suite.locator('li.test.fail');
              const failedTestCount = await failedTestElements.count();

              if (failedTestCount > 0) {
                log(`📋 Suite ${i + 1} contains ${failedTestCount} failed test(s) - extracting content`);

                // Get the complete suite content
                const suiteContent = await suite.textContent();
                log(`✅ Suite ${i + 1} content: ${suiteContent} chars`);
                if (suiteContent && suiteContent.trim().length > 0) {
                  results.output += `\nSuite ${i + 1} :suiteContent->${suiteContent}\n`;
                  log(`✅ Extracted suite ${i + 1} content (${suiteContent.length} chars)`);
                }

                // Count passed and failed tests within this suite
                const passedTestElements = suite.locator('li.test.pass');
                const passedTestCount = await passedTestElements.count();
                totalPasses += passedTestCount;
                totalFailures += failedTestCount;

                log(`📊 Suite ${i + 1}: ${passedTestCount} passed, ${failedTestCount} failed`);
              } else {
                // Count only passed tests for suites without failures
                const passedTestElements = suite.locator('li.test.pass');
                const passedTestCount = await passedTestElements.count();
                if (passedTestCount > 0) {
                  totalPasses += passedTestCount;
                }
              }
            } catch (suiteError) {
              log(`⚠️ Error processing suite ${i + 1}: ${suiteError.message}`);
            }
          }

          log(`the suites are:${results.output}, with content length: ${results.output.length}`);

        } catch (suiteExtractError) {
          log(`⚠️ Error extracting suite content: ${suiteExtractError.message}`);

          // Fallback to basic content extraction
          const fallbackContent = await resultsDiv.textContent();
          if (fallbackContent && fallbackContent.trim().length > 10) {
            results.output = fallbackContent;
            log(`✅ Fallback: extracted basic content (${fallbackContent.length} chars)`);
          }
        }

        try {
            log('🔍 Extracting test results from <li class="passes"><em>X</em></li> and <li class="failures"><em>Y</em></li>...');
            
            // Look for <li class="passes"> and extract <em> content within mocha-report
            const passesLiElements = resultsDiv.locator('li.passes');
            const passesLiCount = await passesLiElements.count();
            log(`Found ${passesLiCount} <li class="passes"> elements`);
            
            if (passesLiCount > 0) {
              // Get the <em> element within the <li class="passes">
              const passesEmElement = passesLiElements.first().locator('em');
              const passesEmCount = await passesEmElement.count();
              
              if (passesEmCount > 0) {
                const passesEmText = await passesEmElement.first().textContent();
                log(`Passes <em> text: "${passesEmText}"`);
                // Extract number from <em> content
                const passesMatch = passesEmText?.match(/(\d+)/);
                if (passesMatch) {
                  results.testResults.passed = parseInt(passesMatch[1], 10);
                  log(`✅ Extracted passed tests from <em>: ${results.testResults.passed}`);
                } else {
                  log(`⚠️ Could not extract number from passes <em> text: "${passesEmText}"`);
                }
              } else {
                log(`⚠️ No <em> element found within <li class="passes">`);
                // Fallback: try to get text content of the li element itself
                const passesLiText = await passesLiElements.first().textContent();
                log(`Passes <li> text fallback: "${passesLiText}"`);
                const passesMatch = passesLiText?.match(/(\d+)/);
                if (passesMatch) {
                  results.testResults.passed = parseInt(passesMatch[1], 10);
                  log(`✅ Extracted passed tests from <li> fallback: ${results.testResults.passed}`);
                }
              }
            } else {
              log(`⚠️ No <li class="passes"> elements found`);
            }
            
            // Look for <li class="failures"> and extract <em> content within mocha-report
            const failuresLiElements = resultsDiv.locator('li.failures');
            const failuresLiCount = await failuresLiElements.count();
            log(`Found ${failuresLiCount} <li class="failures"> elements`);
            
            if (failuresLiCount > 0) {
              // Get the <em> element within the <li class="failures">
              const failuresEmElement = failuresLiElements.first().locator('em');
              const failuresEmCount = await failuresEmElement.count();
              
              if (failuresEmCount > 0) {
                const failuresEmText = await failuresEmElement.first().textContent();
                log(`Failures <em> text: "${failuresEmText}"`);
                // Extract number from <em> content
                const failuresMatch = failuresEmText?.match(/(\d+)/);
                if (failuresMatch) {
                  results.testResults.failed = parseInt(failuresMatch[1], 10);
                  log(`✅ Extracted failed tests from <em>: ${results.testResults.failed}`);
                } else {
                  log(`⚠️ Could not extract number from failures <em> text: "${failuresEmText}"`);
                }
              } else {
                log(`⚠️ No <em> element found within <li class="failures">`);
                // Fallback: try to get text content of the li element itself
                const failuresLiText = await failuresLiElements.first().textContent();
                log(`Failures <li> text fallback: "${failuresLiText}"`);
                const failuresMatch = failuresLiText?.match(/(\d+)/);
                if (failuresMatch) {
                  results.testResults.failed = parseInt(failuresMatch[1], 10);
                  log(`✅ Extracted failed tests from <li> fallback: ${results.testResults.failed}`);
                }
              }
            } else {
              log(`⚠️ No <li class="failures"> elements found`);
            }
            
            // Global search fallback if not found within mocha-report
            if (results.testResults.passed === 0 && results.testResults.failed === 0) {
              log('🔄 Trying global search for <li class="passes"> and <li class="failures">...');
              
              // Global search for <li class="passes"><em>X</em></li>
              const globalPassesLi = win.locator('li.passes');
              const globalPassesLiCount = await globalPassesLi.count();
              if (globalPassesLiCount > 0) {
                const globalPassesEm = globalPassesLi.first().locator('em');
                const globalPassesEmCount = await globalPassesEm.count();
                if (globalPassesEmCount > 0) {
                  const passesEmText = await globalPassesEm.first().textContent();
                  const passesMatch = passesEmText?.match(/(\d+)/);
                  if (passesMatch) {
                    results.testResults.passed = parseInt(passesMatch[1], 10);
                    log(`✅ Found passed tests (global <em>): ${results.testResults.passed}`);
                  }
                }
              }
              
              // Global search for <li class="failures"><em>Y</em></li>
              const globalFailuresLi = win.locator('li.failures');
              const globalFailuresLiCount = await globalFailuresLi.count();
              if (globalFailuresLiCount > 0) {
                const globalFailuresEm = globalFailuresLi.first().locator('em');
                const globalFailuresEmCount = await globalFailuresEm.count();
                if (globalFailuresEmCount > 0) {
                  const failuresEmText = await globalFailuresEm.first().textContent();
                  const failuresMatch = failuresEmText?.match(/(\d+)/);
                  if (failuresMatch) {
                    results.testResults.failed = parseInt(failuresMatch[1], 10);
                    log(`✅ Found failed tests (global <em>): ${results.testResults.failed}`);
                  }
                }
              }
            }
            
            results.testResults.total = results.testResults.passed + results.testResults.failed;
            log(`📊 Total test results: ${results.testResults.total} (${results.testResults.passed} passed, ${results.testResults.failed} failed)`);
            
          } catch (testExtractError) {
            log(`⚠️ Error extracting test counts: ${testExtractError.message}`);
          }
          
          log('\n🎉 Automation completed successfully!');
          results.success = true;
        
        } else {
        log(`❌ mocha-report div not found: ${resultsDivId}`);
        
        // Try alternative div selectors for mocha report
        log('🔄 Trying alternative mocha-report selectors...');
        const altSelectors = [
          '[id*="mocha"]',
          '[class*="mocha"]',
          '[class*="mocha-report"]',
          '.mocha-report',
          '[class*="report"]'
        ];
        
        for (const selector of altSelectors) {
          try {
            const altDiv = win.locator(selector);
            const altCount = await altDiv.count();
            if (altCount > 0) {
              const altContent = await altDiv.textContent();
              if (altContent && altContent.trim().length > 20) {
                log(`✅ Found mocha-report using selector: ${selector}`);
                results.output = altContent;
                
                // Try to extract passes/failures from this alternative content
                const passesMatch = altContent.match(/(\d+)\s*passes?/i);
                const failuresMatch = altContent.match(/(\d+)\s*failures?/i);
                
                if (passesMatch) {
                  results.testResults.passed = parseInt(passesMatch[1], 10);
                  log(`✅ Extracted passed tests from alt content: ${results.testResults.passed}`);
                }
                
                if (failuresMatch) {
                  results.testResults.failed = parseInt(failuresMatch[1], 10);
                  log(`✅ Extracted failed tests from alt content: ${results.testResults.failed}`);
                }
                
                results.testResults.total = results.testResults.passed + results.testResults.failed;
                break;
              }
            }
          } catch (e) {
            // Continue to next selector
          }
        }
      }
      
    } catch (e) {
      log(`❌ Error extracting mocha-report: ${e.message}`);
    }

  } catch (err) {
    log(`❌ Error during automation: ${err.message}`);
  } finally {
    log('\n🔌 Closing application...');
    await app.close();
  }
 // only one debugger here if i put debugger gives me 100k , if dont put debugger gets 65k .
 console.log('🔍 Final structured results:',results.output.length);
  return results;
}

// Main execution
(async () => {
  const appPath = process.argv[2];
  const outputFile = process.argv[3] || '/tmp/fido-results.json';
  const testType = process.argv[4] || 'all';
  try {
    const results = await runFidoAutomation(appPath, testType);

    // Write results to temporary file instead of stdout to avoid buffer limits
    const fs = require('fs');
    fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
    
    console.error(`📁 Results written to ${outputFile} (${results.output.length} chars)`);
    
    // Set exit code based on success
    process.exit(results.success ? 0 : 1);
    
  } catch (error) {
    console.error(`❌ Fatal error: ${error.message}`);
    
    // Output error as structured result to file
    const errorResults = {
      success: false,
      testResults: { passed: 0, failed: 0, total: 0 },
      output: ''
    };
    
    const fs = require('fs');
    fs.writeFileSync(outputFile, JSON.stringify(errorResults, null, 2));
    
    process.exit(1);
  }
})();
