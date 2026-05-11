import { Step } from 'gauge-ts';
import { testContext } from '@/tests/shared/runtime/test-context';

export default class CanvasSteps {
  @Step('clicking on "[data-testid=\'canvas-title-input\']"')
  public async clickCanvasTitleInput(): Promise<void> {
    await testContext.activePage.locator("[data-testid='canvas-title-input']").first().click();
  }

  @Step('clicking on "[data-testid=\'canvas-editor\']"')
  public async clickCanvasEditor(): Promise<void> {
    await testContext.activePage.locator("[data-testid='canvas-editor']").first().click();
  }

  @Step('clicking on "[data-testid=\'canvas-share-button\']"')
  public async clickCanvasShareButton(): Promise<void> {
    await testContext.activePage.locator("[data-testid='canvas-share-button']").first().click();
  }

  @Step('verifying "[data-testid=\'user-search-input\']" is visible')
  public async verifyUserSearchInputVisible(): Promise<void> {
    await testContext.activePage
      .locator("[data-testid='user-search-input']")
      .first()
      .waitFor({ state: 'visible' });
  }

  @Step('verifying "[data-testid=\'canvas-copy-link-button\']" is visible')
  public async verifyCopyLinkButtonVisible(): Promise<void> {
    await testContext.activePage
      .locator("[data-testid='canvas-copy-link-button']")
      .first()
      .waitFor({ state: 'visible' });
  }

  @Step('clicking on "[data-testid=\'visibility-toggle\']"')
  public async clickVisibilityToggle(): Promise<void> {
    await testContext.activePage.locator("[data-testid='visibility-toggle']").first().click();
  }

  @Step('clicking on "[data-testid=\'canvas-more-options\']"')
  public async clickCanvasMoreOptions(): Promise<void> {
    await testContext.activePage.locator("[data-testid='canvas-more-options']").first().click();
  }

  @Step('clicking on "[data-testid=\'delete-confirm-button\']"')
  public async clickDeleteConfirmButton(): Promise<void> {
    await testContext.activePage.locator("[data-testid='delete-confirm-button']").first().click();
  }
}
