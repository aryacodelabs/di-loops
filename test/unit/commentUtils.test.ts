import { describe, expect, it } from 'vitest';
import { isOffsetInComment } from '../../src/scanner/commentUtils';
import { findRegistrationMatches } from '../../src/scanner/patterns';

describe('isOffsetInComment', () => {
  it('detects line comments before the match', () => {
    const source = '//builder.Services.AddScoped<Foo>();\nbuilder.Services.AddScoped<Bar>();';
    const activeOffset = source.indexOf('AddScoped<Bar>');
    const commentedOffset = source.indexOf('AddScoped<Foo>');

    expect(isOffsetInComment(source, commentedOffset)).toBe(true);
    expect(isOffsetInComment(source, activeOffset)).toBe(false);
  });

  it('detects block comments', () => {
    const source = '/* services.AddScoped<Foo>(); */ services.AddScoped<Bar>();';
    const commentedOffset = source.indexOf('AddScoped<Foo>');
    const activeOffset = source.indexOf('AddScoped<Bar>');

    expect(isOffsetInComment(source, commentedOffset)).toBe(true);
    expect(isOffsetInComment(source, activeOffset)).toBe(false);
  });

  it('does not treat // inside strings as comments', () => {
    const source = 'var hint = "use // not a comment"; services.AddScoped<Foo>();';
    const offset = source.indexOf('AddScoped<Foo>');
    expect(isOffsetInComment(source, offset)).toBe(false);
  });
});

describe('findRegistrationMatches comment filtering', () => {
  it('ignores commented duplicate registrations', () => {
    const source = `
builder.Services.AddScoped<IStringStateStorage, FluxorLocalStorage>();
// builder.Services.AddScoped<IStringStateStorage, FluxorProtectedLocalStorage>();
builder.Services.AddScoped<IStoreHandler, ZijiJsonStoreHandler>();
//builder.Services.AddSingleton<IStoreHandler, DictionaryStoreHandler>();
`;

    const matches = findRegistrationMatches(source);
    expect(matches.map((match) => match.serviceType)).toEqual(['IStringStateStorage', 'IStoreHandler']);
  });
});