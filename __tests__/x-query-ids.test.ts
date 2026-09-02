import { describe, it, expect } from 'vitest'
import { extractQueryIds, bundleUrlsFromHtml, addMissingFeatures } from '@/lib/x-query-ids'
import { buildDirectImportScript, toBookmarkletHref } from '@/lib/x-direct-import-script'

describe('extractQueryIds', () => {
  it('pulls the operations we care about out of bundle source', () => {
    const js = 'x={queryId:"aoDbu3RHznuiSkQ9aNM67Q",operationName:"CreateBookmark"};y={queryId:"iblrFnKr6PZUR-dWpfXG6g",operationName:"Bookmarks",operationType:"query"};z={queryId:"xA8fDIbrJfy4ojjjXmSR-A",operationName:"Likes"}'
    expect(extractQueryIds(js)).toEqual({ Bookmarks: 'iblrFnKr6PZUR-dWpfXG6g', Likes: 'xA8fDIbrJfy4ojjjXmSR-A' })
  })
})

describe('bundleUrlsFromHtml', () => {
  it('finds main.js and the hashed chunks whose names mention History or Bookmarks', () => {
    const html = [
      '<script src="https://abs.twimg.com/responsive-web/client-web/main.526a2b20e520717ea.js"></script>',
      'a={96889:"bundle.History",69742:"bundle.Bookmarks",60288:"bundle.Explore"}',
      'b={96889:"0123456789abcdef",69742:"fedcba9876543210",60288:"aaaaaaaaaaaaaaaa"}',
    ].join('\n')
    const urls = bundleUrlsFromHtml(html)
    expect(urls).toContain('https://abs.twimg.com/responsive-web/client-web/main.526a2b20e520717ea.js')
    expect(urls).toContain('https://abs.twimg.com/responsive-web/client-web/bundle.History.0123456789abcdefa.js')
    expect(urls).toContain('https://abs.twimg.com/responsive-web/client-web/bundle.Bookmarks.fedcba9876543210a.js')
    expect(urls.some((u) => u.includes('Explore'))).toBe(false)
  })
})

describe('addMissingFeatures', () => {
  it("parses X's 400 error and adds the named flags", () => {
    const features: Record<string, boolean> = { a: true }
    const added = addMissingFeatures('{"errors":[{"message":"The following features cannot be null: new_flag_one, new_flag_two"}]}', features)
    expect(added).toEqual(['new_flag_one', 'new_flag_two'])
    expect(features.new_flag_two).toBe(true)
  })
  it('returns nothing for unrelated errors', () => {
    expect(addMissingFeatures('{"errors":[{"message":"Rate limit"}]}', {})).toEqual([])
  })
})

describe('buildDirectImportScript', () => {
  it('embeds the config and produces a parseable script and bookmarklet href', () => {
    const script = buildDirectImportScript({ origin: 'http://localhost:3000/', bookmarksQueryId: 'QID1', likesQueryId: 'QID2', source: 'bookmark' })
    expect(script).toContain('"origin":"http://localhost:3000"')
    expect(script).toContain('"bookmarksQueryId":"QID1"')
    expect(() => new Function(script)).not.toThrow()
    expect(toBookmarkletHref(script).startsWith('javascript:')).toBe(true)
  })
})
