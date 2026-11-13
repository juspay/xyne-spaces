import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConnectorCatalog } from './ConnectorCatalog.js';
import type { ConnectorItem } from '../../../utils/connector-groups.js';

const trigger = (type: string, name: string, connectorId: string, connectorName: string): ConnectorItem => ({
  type,
  name,
  description: `${name} description`,
  connectorId,
  connectorName,
});

const manual = trigger('MANUAL', 'Manual Trigger', 'builtin', 'Built-in');
const cron = trigger('CRON', 'Cron Trigger', 'builtin', 'Built-in');
const issues = trigger('github.issues', 'Issue', 'github', 'GitHub');
const issueComment = trigger('github.issue_comment', 'Issue or pull request comment', 'github', 'GitHub');
const items = [manual, cron, issues, issueComment];

describe('ConnectorCatalog', () => {
  it("lists connectors first, then only the opened connector's items", () => {
    const onSelect = vi.fn();
    render(<ConnectorCatalog items={items} noun="trigger" onSelect={onSelect} />);

    expect(screen.getByRole('button', { name: /^Built-in/ })).toHaveTextContent('2 triggers');
    expect(screen.queryByText('Issue')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^GitHub/ }));
    expect(screen.getByText('Issue')).toBeInTheDocument();
    expect(screen.queryByText('Manual Trigger')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Issue or pull request comment/ }));
    expect(onSelect).toHaveBeenCalledWith(issueComment);
  });

  it('goes back to the connector list', () => {
    render(<ConnectorCatalog items={items} noun="trigger" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^GitHub/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Back to connectors' }));

    expect(screen.getByRole('button', { name: /^GitHub/ })).toBeInTheDocument();
    expect(screen.queryByText('Issue')).not.toBeInTheDocument();
  });

  it('leaves the connector on Escape before a dialog listening on the document sees it', () => {
    const onDialogEscape = vi.fn();
    const dialogListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDialogEscape();
    };
    document.addEventListener('keydown', dialogListener);
    try {
      render(<ConnectorCatalog items={items} noun="trigger" onSelect={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /^GitHub/ }));

      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
      expect(screen.getByRole('button', { name: /^GitHub/ })).toBeInTheDocument();
      expect(onDialogEscape).not.toHaveBeenCalled();

      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
      expect(onDialogEscape).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', dialogListener);
    }
  });

  it("searches every connector from the connector list, naming each match's connector", () => {
    render(<ConnectorCatalog items={items} noun="trigger" onSelect={vi.fn()} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'comment' } });

    expect(screen.getByRole('button', { name: /^Issue or pull request comment/ })).toHaveTextContent('GitHub');
    expect(screen.queryByRole('button', { name: /^Built-in/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Manual Trigger')).not.toBeInTheDocument();
  });

  it('searches only the opened connector', () => {
    render(<ConnectorCatalog items={items} noun="trigger" onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Built-in/ }));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'issue' } });

    expect(screen.getByText('No triggers found')).toBeInTheDocument();
  });

  it('shows the items straight away when only one connector provides any', () => {
    render(<ConnectorCatalog items={[manual, cron]} noun="trigger" onSelect={vi.fn()} />);

    expect(screen.getByText('Manual Trigger')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to connectors' })).not.toBeInTheDocument();
  });

  it('marks the selected item', () => {
    render(<ConnectorCatalog items={[manual, cron]} noun="trigger" onSelect={vi.fn()} selectedType="CRON" />);

    expect(screen.getByRole('button', { name: /^Cron Trigger/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /^Manual Trigger/ })).not.toHaveAttribute('aria-current');
  });
});
