/**
 * The form, driven. Its logic is tested in `computation.test.ts` and the
 * language it writes in the SDK; what is left to assert here is that the
 * controls produce and recover what they claim to.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Calculate } from './Calculate.js';
import type { FlowValue } from './DataSections.js';

const value = (
  label: string,
  path: string,
  type: string | undefined,
  itemFields?: Array<{ path: string; type: string | undefined }>,
): FlowValue => ({ label, path, type, ref: `{{${path}}}`, ...(itemFields ? { itemFields } : {}) });

const plain = [
  {
    group: 'Refund lookup',
    items: [
      value('body.total', 'steps.invoice.output.body.total', 'number'),
      value('body.amount', 'steps.credit.output.body.amount', 'number'),
    ],
  },
];

const withItems = [
  {
    group: 'Refund lookup',
    items: [
      value('body.items', 'steps.refund.output.body.items', 'array', [
        { path: 'tag', type: 'string' },
        { path: 'amount', type: 'number' },
      ]),
    ],
  },
];

const pickOperation = (name: string) =>
  fireEvent.change(screen.getByLabelText('What to work out'), { target: { value: name } });

describe('writing one', () => {
  it('inserts the expression it shows', () => {
    const inserted: string[] = [];
    render(<Calculate groups={plain} onInsert={(t) => inserted.push(t)} onCancel={() => {}} />);

    pickOperation('$sum');
    fireEvent.change(screen.getByLabelText('Value 1'), {
      target: { value: 'steps.invoice.output.body.total' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ add another value' }));
    fireEvent.change(screen.getByLabelText('Value 2'), {
      target: { value: 'steps.credit.output.body.amount' },
    });

    const expected =
      '{% $sum([steps.invoice.output.body.total, steps.credit.output.body.amount]) %}';
    // Shown before it is inserted — the only thing an author can check here,
    // since nothing in this editor holds the data a run would have.
    expect(screen.getByText(expected)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(inserted).toEqual([expected]);
  });

  it('adds up one kind of line item — the whole original requirement', () => {
    const inserted: string[] = [];
    render(<Calculate groups={withItems} onInsert={(t) => inserted.push(t)} onCancel={() => {}} />);

    pickOperation('$sum');
    fireEvent.change(screen.getByLabelText('Value 1'), {
      target: { value: 'steps.refund.output.body.items' },
    });
    // The filter appears only because the list declared what its items look like.
    fireEvent.change(screen.getByLabelText('Filter field 1'), { target: { value: 'tag' } });
    fireEvent.change(screen.getByLabelText('Filter value 1'), { target: { value: 'fee' } });
    fireEvent.change(screen.getByLabelText('Use field 1'), { target: { value: 'amount' } });

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(inserted).toEqual([
      '{% $sum([steps.refund.output.body.items[tag = "fee"].amount]) %}',
    ]);
  });

  it('offers no filter for a value that is not a list of objects', () => {
    render(<Calculate groups={plain} onInsert={() => {}} onCancel={() => {}} />);
    pickOperation('$sum');
    fireEvent.change(screen.getByLabelText('Value 1'), {
      target: { value: 'steps.invoice.output.body.total' },
    });
    expect(screen.queryByLabelText('Filter field 1')).toBeNull();
    expect(screen.queryByLabelText('Use field 1')).toBeNull();
  });

  it('cannot insert until it has something to insert', () => {
    render(<Calculate groups={plain} onInsert={() => {}} onCancel={() => {}} />);
    const insert = () => screen.getByRole('button', { name: 'Insert' });
    expect(insert()).toHaveProperty('disabled', true);
    pickOperation('$sum');
    expect(insert()).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Value 1'), {
      target: { value: 'steps.invoice.output.body.total' },
    });
    expect(insert()).toHaveProperty('disabled', false);
  });
});

describe('editing one again', () => {
  it('opens holding what was already there', () => {
    render(
      <Calculate
        groups={withItems}
        initial={'{% $sum([steps.refund.output.body.items[tag = "fee"].amount]) %}'}
        onInsert={() => {}}
        onCancel={() => {}}
      />,
    );
    // Every control recovered, not just the operation.
    expect((screen.getByLabelText('What to work out') as HTMLSelectElement).value).toBe('$sum');
    expect((screen.getByLabelText('Value 1') as HTMLSelectElement).value).toBe(
      'steps.refund.output.body.items',
    );
    expect((screen.getByLabelText('Filter field 1') as HTMLSelectElement).value).toBe('tag');
    expect((screen.getByLabelText('Filter value 1') as HTMLInputElement).value).toBe('fee');
    expect((screen.getByLabelText('Use field 1') as HTMLSelectElement).value).toBe('amount');
  });

  it('says so, rather than guessing, when it cannot read what is there', () => {
    render(
      <Calculate
        groups={plain}
        initial={'{% $substringBefore(trigger.context.a, "@") %}'}
        onInsert={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText(/written by hand/)).toBeTruthy();
    expect((screen.getByLabelText('What to work out') as HTMLSelectElement).value).toBe('');
  });
});

/** The real shape that started this: a fare breakdown, as a list of objects. */
const fares = [
  {
    group: 'Ride lookup',
    items: [
      value('body.fareBreakup', 'steps.ride.output.body.fareBreakup', 'array', [
        { path: 'description', type: 'string' },
        { path: 'amount.amount', type: 'integer' },
        { path: 'amount.currency', type: 'string' },
      ]),
      value('body.actualFare', 'steps.ride.output.body.actualFare', 'integer'),
      value('body.tags', 'steps.ride.output.body.tags', 'array'),
    ],
  },
];

describe('listing every item', () => {
  const open = () => {
    const inserted: string[] = [];
    render(<Calculate groups={fares} onInsert={(t) => inserted.push(t)} onCancel={() => {}} />);
    pickOperation('each-item');
    return inserted;
  };

  const chooseList = () =>
    fireEvent.change(screen.getByLabelText('Which list'), {
      target: { value: 'steps.ride.output.body.fareBreakup' },
    });

  /** The box commits on blur, the way a screen's message box does. */
  const writeLine = (text: string) => {
    const box = screen.getByLabelText('What each item reads');
    fireEvent.change(box, { target: { value: text } });
    fireEvent.blur(box);
  };

  it('writes the breakdown the requirement asked for', () => {
    const inserted = open();
    chooseList();
    writeLine('{{description}} = {{amount.amount}}');

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(inserted).toEqual([
      '{% $join($map(steps.ride.output.body.fareBreakup, function($i){ ' +
        '$string($i.description) & " = " & $string($i.amount.amount) }), "\\n") %}',
    ]);
  });

  it('takes whatever markup the channel wants', () => {
    const inserted = open();
    chooseList();
    writeLine('*{{description}}* — ₹{{amount.amount}}');
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(inserted[0]).toContain('"*" & $string($i.description) & "* — ₹" &');
  });

  it('shows what a line will read, so the layout is checkable without data', () => {
    open();
    chooseList();
    writeLine('*{{description}}* — ₹{{amount.amount}}');
    expect(screen.getByText(/\*<description>\* — ₹<amount.amount>/)).toBeTruthy();
  });

  it('offers the item fields, and drops one in where the cursor is', () => {
    open();
    chooseList();
    fireEvent.click(screen.getByRole('button', { name: 'Insert a field…' }));
    const picker = screen.getByRole('listbox', { name: 'Insert a field' });
    expect(Array.from(picker.querySelectorAll('button'), (b) => b.textContent)).toEqual([
      'description',
      'amount.amount',
      'amount.currency',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'amount.amount' }));
    expect((screen.getByLabelText('What each item reads') as HTMLTextAreaElement).value).toBe(
      '{{amount.amount}}',
    );
  });

  it('opens the field list when someone types the braces', () => {
    open();
    chooseList();
    expect(screen.queryByRole('listbox', { name: 'Insert a field' })).toBeNull();
    fireEvent.change(screen.getByLabelText('What each item reads'), { target: { value: '{{' } });
    expect(screen.getByRole('listbox', { name: 'Insert a field' })).toBeTruthy();
  });

  it('carries the narrowing and the empty message through', () => {
    const inserted = open();
    chooseList();
    fireEvent.change(screen.getByLabelText('Filter field'), { target: { value: 'amount.amount' } });
    fireEvent.change(screen.getByLabelText('Filter test'), { target: { value: '>' } });
    fireEvent.change(screen.getByLabelText('Filter value'), { target: { value: '0' } });
    writeLine('{{description}}');
    fireEvent.change(screen.getByLabelText('Between items'), { target: { value: ', ' } });
    fireEvent.change(screen.getByLabelText('If the list is empty'), {
      target: { value: 'No charges.' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(inserted).toEqual([
      '{% $count(steps.ride.output.body.fareBreakup[amount.amount > 0]) = 0 ? "No charges." : ' +
        '$join($map(steps.ride.output.body.fareBreakup[amount.amount > 0], ' +
        'function($i){ $string($i.description) }), ", ") %}',
    ]);
  });

  it('will not insert until there is a line to show', () => {
    open();
    chooseList();
    expect((screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    writeLine('{{description}}');
    expect((screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('keeps the line when the list is switched, since those are the author’s words', () => {
    open();
    chooseList();
    writeLine('{{description}}');
    fireEvent.change(screen.getByLabelText('Which list'), { target: { value: '' } });
    chooseList();
    expect((screen.getByLabelText('What each item reads') as HTMLTextAreaElement).value).toBe(
      '{{description}}',
    );
  });

  it('offers only the lists that have fields to show', () => {
    open();
    const options = Array.from(
      (screen.getByLabelText('Which list') as HTMLSelectElement).options,
      (option) => option.value,
    );
    // Not the number, and not the list of plain values — `$join` already does that one.
    expect(options).toEqual(['', 'steps.ride.output.body.fareBreakup']);
  });

  it('re-opens on what it wrote, every control holding its value', () => {
    const written =
      '{% $count(steps.ride.output.body.fareBreakup[amount.amount > 0]) = 0 ? "No charges." : ' +
      '$join($map(steps.ride.output.body.fareBreakup[amount.amount > 0], ' +
      'function($i){ "*" & $string($i.description) & "* — ₹" & $string($i.amount.amount) }), ", ") %}';
    const inserted: string[] = [];
    render(
      <Calculate
        groups={fares}
        initial={written}
        onInsert={(t) => inserted.push(t)}
        onCancel={() => {}}
      />,
    );

    expect((screen.getByLabelText('What to work out') as HTMLSelectElement).value).toBe('each-item');
    expect((screen.getByLabelText('Which list') as HTMLSelectElement).value).toBe(
      'steps.ride.output.body.fareBreakup',
    );
    expect((screen.getByLabelText('Filter field') as HTMLSelectElement).value).toBe('amount.amount');
    expect((screen.getByLabelText('Filter value') as HTMLInputElement).value).toBe('0');
    expect((screen.getByLabelText('What each item reads') as HTMLTextAreaElement).value).toBe(
      '*{{description}}* — ₹{{amount.amount}}',
    );
    expect((screen.getByLabelText('Between items') as HTMLSelectElement).value).toBe(', ');
    expect((screen.getByLabelText('If the list is empty') as HTMLInputElement).value).toBe(
      'No charges.',
    );

    // Unchanged in, unchanged out.
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(inserted).toEqual([written]);
  });

  it('is not offered where only a number will do', () => {
    render(<Calculate groups={fares} expects="number" onInsert={() => {}} onCancel={() => {}} />);
    const options = Array.from(
      (screen.getByLabelText('What to work out') as HTMLSelectElement).options,
      (option) => option.value,
    );
    expect(options).not.toContain('each-item');
    expect(options).toContain('$sum');
  });

  it('says so when there is no list to write out, and where one comes from', () => {
    render(<Calculate groups={plain} onInsert={() => {}} onCancel={() => {}} />);
    pickOperation('each-item');
    expect(screen.getByText(/Nothing this screen can see is a list of items/)).toBeTruthy();
    expect(screen.getByText(/What comes back/)).toBeTruthy();
  });

  it('names the list, rather than denying it, when its items are a mystery', () => {
    const opaque = [
      {
        group: 'Ride lookup',
        items: [value('body.fareBreakup', 'steps.ride.output.body.fareBreakup', 'array')],
      },
    ];
    render(<Calculate groups={opaque} onInsert={() => {}} onCancel={() => {}} />);
    pickOperation('each-item');
    expect(screen.getByText(/body.fareBreakup/)).toBeTruthy();
    expect(screen.getByText(/nothing is known about what each item holds/)).toBeTruthy();
    expect(screen.getByText(/paste a sample response/)).toBeTruthy();
  });
});

describe('writing one by hand', () => {
  it('carries what the form built into the editor, and inserts it', () => {
    const inserted: string[] = [];
    render(<Calculate groups={withItems} onInsert={(t) => inserted.push(t)} onCancel={() => {}} />);

    pickOperation('$sum');
    fireEvent.change(screen.getByLabelText('Value 1'), {
      target: { value: 'steps.refund.output.body.items' },
    });
    fireEvent.change(screen.getByLabelText('Use field 1'), { target: { value: 'amount' } });
    fireEvent.click(screen.getByRole('button', { name: 'or write it yourself' }));

    // Seeded, not blank — "nearly right" is the reason anyone clicks this.
    expect(screen.getByRole('textbox').textContent).toBe(
      '$sum([steps.refund.output.body.items.amount])',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(inserted).toEqual(['{% $sum([steps.refund.output.body.items.amount]) %}']);
  });

  it('offers a field of every item, which no chip can name', () => {
    render(<Calculate groups={withItems} onInsert={() => {}} onCancel={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'or write it yourself' }));
    fireEvent.click(screen.getByRole('button', { name: '+ value' }));

    const picker = screen.getByRole('listbox', { name: 'Insert a value' });
    expect(picker.textContent).toContain('steps.refund.output.body.items');
    expect(picker.textContent).toContain('…amount');
  });

  it('goes back to the form, which re-reads what is there', () => {
    render(<Calculate groups={withItems} onInsert={() => {}} onCancel={() => {}} />);
    pickOperation('$count');
    fireEvent.change(screen.getByLabelText('Value 1'), {
      target: { value: 'steps.refund.output.body.items' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'or write it yourself' }));
    fireEvent.click(screen.getByRole('button', { name: 'use the form instead' }));
    expect((screen.getByLabelText('What to work out') as HTMLSelectElement).value).toBe('$count');
  });

  it('opens on a hand-written expression the form cannot read', () => {
    render(
      <Calculate
        groups={withItems}
        initial="{% $substringBefore(steps.refund.output.body.items[0].tag, '-') %}"
        onInsert={() => {}}
        onCancel={() => {}}
      />,
    );
    // The form says so rather than pretending…
    expect(screen.getByText(/written by hand, so this form starts empty/)).toBeTruthy();
    // …and the editor holds it intact, so nothing is lost by looking.
    fireEvent.click(screen.getByRole('button', { name: 'or write it yourself' }));
    expect(screen.getByRole('textbox').textContent).toBe(
      "$substringBefore(steps.refund.output.body.items[0].tag, '-')",
    );
  });
});

describe('a fixed value, beside a picked one', () => {
  /** Numbers and text, so a parameter that wants one is actually offered it. */
  const mixed = [
    {
      group: 'Refund lookup',
      items: [
        value('body.total', 'steps.invoice.output.body.total', 'number'),
        value('body.status', 'steps.invoice.output.body.status', 'string'),
      ],
    },
  ];

  const open = (fn: string) => {
    const inserted: string[] = [];
    render(<Calculate groups={mixed} onInsert={(t) => inserted.push(t)} onCancel={() => {}} />);
    pickOperation(fn);
    return inserted;
  };

  it('multiplies a value by a number someone typed', () => {
    const inserted = open('multiply');
    fireEvent.change(screen.getByLabelText('Value 1'), {
      target: { value: 'steps.invoice.output.body.total' },
    });
    fireEvent.change(screen.getByLabelText('How value 2 is given'), { target: { value: 'fixed' } });
    fireEvent.change(screen.getByLabelText('Fixed 2'), { target: { value: '1.18' } });

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    // Written the way JSONata spells it, which is not as a function at all.
    expect(inserted).toEqual(['{% steps.invoice.output.body.total * 1.18 %}']);
  });

  it('offers arithmetic at all, which it did not before', () => {
    render(<Calculate groups={mixed} onInsert={() => {}} onCancel={() => {}} />);
    const names = Array.from(
      (screen.getByLabelText('What to work out') as HTMLSelectElement).options,
      (o) => o.value,
    );
    expect(names).toEqual(expect.arrayContaining(['add', 'subtract', 'multiply', 'divide']));
  });

  it('no longer ships a placeholder as a finished answer', () => {
    const inserted = open('$replace');
    fireEvent.change(screen.getByLabelText('Value 1'), {
      target: { value: 'steps.invoice.output.body.status' },
    });
    // Every other argument is a control now. Before, "old" and "new" were baked
    // into the expression and could not be reached.
    fireEvent.change(screen.getByLabelText('How value 2 is given'), { target: { value: 'fixed' } });
    fireEvent.change(screen.getByLabelText('Fixed 2'), { target: { value: 'BASE_' } });
    fireEvent.change(screen.getByLabelText('How value 3 is given'), { target: { value: 'fixed' } });
    fireEvent.change(screen.getByLabelText('Fixed 3'), { target: { value: 'Base ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(inserted).toEqual([
      '{% $replace(steps.invoice.output.body.status, "BASE_", "Base ") %}',
    ]);
  });

  it('leaves a trailing optional argument off when nobody filled it', () => {
    const inserted = open('$round');
    fireEvent.change(screen.getByLabelText('Value 1'), {
      target: { value: 'steps.invoice.output.body.total' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(inserted).toEqual(['{% $round(steps.invoice.output.body.total) %}']);
  });

  it('will not insert a fixed value the parameter cannot hold', () => {
    open('$round');
    fireEvent.change(screen.getByLabelText('Value 1'), {
      target: { value: 'steps.invoice.output.body.total' },
    });
    fireEvent.change(screen.getByLabelText('How value 2 is given'), { target: { value: 'fixed' } });
    fireEvent.change(screen.getByLabelText('Fixed 2'), { target: { value: 'abc' } });
    // Refused here rather than at runtime, in front of a customer.
    expect((screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.change(screen.getByLabelText('Fixed 2'), { target: { value: '0' } });
    expect((screen.getByRole('button', { name: 'Insert' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('re-opens a fixed value as a fixed value, not as a path', () => {
    render(
      <Calculate
        groups={mixed}
        initial="{% steps.invoice.output.body.total * 1.18 %}"
        onInsert={() => {}}
        onCancel={() => {}}
      />,
    );
    expect((screen.getByLabelText('What to work out') as HTMLSelectElement).value).toBe('multiply');
    expect((screen.getByLabelText('How value 2 is given') as HTMLSelectElement).value).toBe('fixed');
    expect((screen.getByLabelText('Fixed 2') as HTMLInputElement).value).toBe('1.18');
  });
});

describe('re-opening what was saved', () => {
  const mixed = [
    {
      group: 'Refund lookup',
      items: [
        value('body.total', 'steps.invoice.output.body.total', 'number'),
        value('body.amount', 'steps.credit.output.body.amount', 'number'),
        value('body.status', 'steps.invoice.output.body.status', 'string'),
      ],
    },
  ];

  const reopen = (written: string) => {
    const inserted: string[] = [];
    render(
      <Calculate
        groups={mixed}
        initial={written}
        onInsert={(t) => inserted.push(t)}
        onCancel={() => {}}
      />,
    );
    return inserted;
  };

  it('brings back every value of a sum, not just the first', () => {
    const written =
      '{% $sum([steps.invoice.output.body.total, steps.credit.output.body.amount]) %}';
    const inserted = reopen(written);

    expect((screen.getByLabelText('What to work out') as HTMLSelectElement).value).toBe('$sum');
    expect((screen.getByLabelText('Value 1') as HTMLSelectElement).value).toBe(
      'steps.invoice.output.body.total',
    );
    // The one that used to vanish: a list parameter is one argument holding
    // several entries, so mapping arguments to rows showed only the first.
    expect((screen.getByLabelText('Value 2') as HTMLSelectElement).value).toBe(
      'steps.credit.output.body.amount',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(inserted).toEqual([written]);
  });

  it('brings back a third value added before saving', () => {
    reopen(
      '{% $sum([steps.invoice.output.body.total, steps.credit.output.body.amount, steps.invoice.output.body.total]) %}',
    );
    expect(screen.getByLabelText('Value 3')).toBeTruthy();
  });

  it('still shows an optional control that was left off', () => {
    // `$round(x)` is complete and has one argument; the places control has to
    // come back anyway, or there is no way to set it but to start again.
    reopen('{% $round(steps.invoice.output.body.total) %}');
    expect((screen.getByLabelText('Value 1') as HTMLSelectElement).value).toBe(
      'steps.invoice.output.body.total',
    );
    expect((screen.getByLabelText('How value 2 is given') as HTMLSelectElement).value).toBe(
      'value',
    );
    expect((screen.getByLabelText('Value 2') as HTMLSelectElement).value).toBe('');
  });

  it('can add the places it was saved without', () => {
    const inserted = reopen('{% $round(steps.invoice.output.body.total) %}');
    fireEvent.change(screen.getByLabelText('How value 2 is given'), { target: { value: 'fixed' } });
    fireEvent.change(screen.getByLabelText('Fixed 2'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(inserted).toEqual(['{% $round(steps.invoice.output.body.total, 0) %}']);
  });
});

describe('filtering a text field against a number-looking value', () => {
  const codes = [
    {
      group: 'Orders lookup',
      items: [
        value('body.items', 'steps.orders.output.body.items', 'array', [
          { path: 'code', type: 'string' },
          { path: 'amount', type: 'number' },
        ]),
      ],
    },
  ];

  it('quotes it, because the field is text', () => {
    const inserted: string[] = [];
    render(<Calculate groups={codes} onInsert={(t) => inserted.push(t)} onCancel={() => {}} />);
    pickOperation('$count');
    fireEvent.change(screen.getByLabelText('Value 1'), {
      target: { value: 'steps.orders.output.body.items' },
    });
    fireEvent.change(screen.getByLabelText('Filter field 1'), { target: { value: 'code' } });
    fireEvent.change(screen.getByLabelText('Filter value 1'), { target: { value: '10' } });

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    // Unquoted, this matches nothing and says nothing about why.
    expect(inserted).toEqual(['{% $count([steps.orders.output.body.items[code = "10"]]) %}']);
  });

  it('leaves it bare where the field really is a number', () => {
    const inserted: string[] = [];
    render(<Calculate groups={codes} onInsert={(t) => inserted.push(t)} onCancel={() => {}} />);
    pickOperation('$count');
    fireEvent.change(screen.getByLabelText('Value 1'), {
      target: { value: 'steps.orders.output.body.items' },
    });
    fireEvent.change(screen.getByLabelText('Filter field 1'), { target: { value: 'amount' } });
    fireEvent.change(screen.getByLabelText('Filter test 1'), { target: { value: '>' } });
    fireEvent.change(screen.getByLabelText('Filter value 1'), { target: { value: '10' } });

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(inserted).toEqual(['{% $count([steps.orders.output.body.items[amount > 10]]) %}']);
  });
});

describe('adding and removing a value', () => {
  it('takes a row away again, without clearing the ones that were meant', () => {
    const inserted: string[] = [];
    render(<Calculate groups={plain} onInsert={(t) => inserted.push(t)} onCancel={() => {}} />);
    pickOperation('$sum');
    fireEvent.change(screen.getByLabelText('Value 1'), {
      target: { value: 'steps.invoice.output.body.total' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ add another value' }));
    expect(screen.getByLabelText('Value 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '− one fewer' }));
    expect(screen.queryByLabelText('Value 2')).toBeNull();
    // The first row is untouched — choosing the operation again would have
    // cleared it, which was the only way back before.
    // Still "Value 1", not "Which value": a list operation can always take
    // another, so the numbering does not come and go.
    expect((screen.getByLabelText('Value 1') as HTMLSelectElement).value).toBe(
      'steps.invoice.output.body.total',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(inserted).toEqual(['{% $sum([steps.invoice.output.body.total]) %}']);
  });

  it('offers nothing to remove when there is only one row', () => {
    render(<Calculate groups={plain} onInsert={() => {}} onCancel={() => {}} />);
    pickOperation('$sum');
    expect(screen.queryByRole('button', { name: '− one fewer' })).toBeNull();
  });
});
