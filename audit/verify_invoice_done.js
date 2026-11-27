await page.getByRole('button',{name:'View invoice PDF'}).click();
await expect(page.getByRole('dialog',{name:'Invoice AUDIT-201'})).toBeVisible();
await expect(page.locator('.bl-doc-co')).toHaveText('UX Audit Company');
await page.keyboard.press('Escape');
await expect(page.getByRole('button',{name:'View invoice PDF'})).toBeFocused();
const result = {invoiceDialogVerified:true,errors:auditErrors};
await page.close();
return result;